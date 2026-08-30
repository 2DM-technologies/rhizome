import { rnetUriPattern, validateMediaObject, type MediaObject, type Vibe } from "@rnet/types";
import {
  SIMPLEFIN_PARSER_NAME,
  SIMPLEFIN_PROVIDER,
  SOURCE_ID_PATTERN,
  type CreateImportPreviewRequest,
  type PullVibeRequest,
  type SimpleFinSourceConfig,
} from "@rhizome/store-contract";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { transactionParserFor } from "../../../ingest/src/parser-catalog.ts";
import type {
  ParsedAccountBalance,
  ParsedTransactions,
} from "../../../ingest/transactions/types.ts";
import {
  verifyTransactions,
  type HistoryRecoveryEvidence,
  type VerifyReport,
} from "../../../ingest/transactions/verify.ts";
import type { BlobStore } from "../blobs/index.ts";
import { contentHash } from "../blobs/content.ts";
import type { Database, DatabaseTransaction } from "../db/index.ts";
import { grants } from "../db/models/grant.ts";
import {
  ingestionSourceFetches,
  type DbIngestionSourceFetch,
} from "../db/models/ingestion-source-fetch.ts";
import { ingestionSources, type DbIngestionSource } from "../db/models/ingestion-source.ts";
import { ingestionSourceObjects } from "../db/models/ingestion-source-object.ts";
import { mediaElements, type MediaElementKind } from "../db/models/media-element.ts";
import { mediaObjectElements } from "../db/models/media-object-element.ts";
import { mediaObjectOrigins } from "../db/models/media-object-origin.ts";
import { mediaObjectRevisions } from "../db/models/media-object-revision.ts";
import { mediaObjects } from "../db/models/media-object.ts";
import { operations, type DbOperation } from "../db/models/operation.ts";
import { originArtifacts, type DbOriginArtifact } from "../db/models/origin-artifact.ts";
import { sourceCredentials, type DbSourceCredential } from "../db/models/source-credential.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import { vibeRevisions } from "../db/models/vibe-revision.ts";
import { vibes, type DbVibe } from "../db/models/vibe.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import { RNET_SCHEMA_VERSION } from "../rnet.ts";
import type { VibeAggregate } from "../serializers/vibe-serializer.ts";
import { AccessService } from "./access-service.ts";
import { storeOwnedOriginArtifact } from "./origin-artifact-service.ts";
import {
  createLocalSourceCredentialCrypto,
  credentialAssociatedData,
  type CredentialEncryptionKeys,
  type SourceCredentialCrypto,
} from "./source-credential-crypto.ts";
import type { SimpleFinAccountsRequest } from "./simplefin-client.ts";
import type { ServiceContext } from "./types.ts";

interface ImportPreviewResult {
  candidates: MediaObject[];
  elements: StagedElement[];
  verify: VerifyReport;
  source_digest: string;
  staged_origin: string;
  review_digest: string;
}

interface StagedCandidate {
  candidate: MediaObject;
  candidate_digest: string;
  elements: StagedElement[];
  identity: string;
  origin_uuid: string;
  source_uuid: string;
}

interface PullSourceResult {
  source: string;
  verify: VerifyReport;
}

interface PullOperationResult {
  added_count: number;
  candidate_count: number;
  candidates: MediaObject[];
  elements: StagedElement[];
  created_count: number;
  dry_run: boolean;
  duplicate_count: number;
  policy: "append_new" | "replace" | "suggest_only";
  removed_count: number;
  source_results: PullSourceResult[];
}

interface ResolvedSourceBase {
  source: DbIngestionSource;
  sourceStateDigest: string;
}

interface ResolvedOriginSource extends ResolvedSourceBase {
  kind: "origin";
  origin: DbOriginArtifact;
}

interface ResolvedCredentialSource extends ResolvedSourceBase {
  kind: "credential";
  credential: DbSourceCredential;
  baseline?: {
    fetch: DbIngestionSourceFetch;
    origin: DbOriginArtifact;
  };
}

type ResolvedSource = ResolvedOriginSource | ResolvedCredentialSource;

type StagedElementRole = "title" | "content" | "preview";

/**
 * A provider-neutral manifest for a payload captured during preview. File transaction
 * parsers currently emit zero elements, while later media providers can populate this
 * same reviewed and atomically committed path.
 */
export interface StagedElement {
  uri: string;
  object_uri: string;
  role: StagedElementRole;
  kind: MediaElementKind;
  mime: string;
  byte_size: number;
  content_hash: string;
  preview_url: string;
}

interface StagedSourceCapture {
  candidates: StagedCandidate[];
  fetchUuid?: string;
  kind: "origin" | "credential";
  origin: DbOriginArtifact;
  source: DbIngestionSource;
  sourceStateDigest: string;
  verify: VerifyReport;
}

interface CredentialFetchReservation {
  fetchUuid: string;
  release: () => Promise<void>;
  resolved: ResolvedCredentialSource;
}

const SIMPLEFIN_FETCH_LIMIT = 24;
const SIMPLEFIN_FETCH_WINDOW_HOURS = 24;
// Ordinary pulls retain a 15-day overlap at a monthly cadence. When a committed balance is older,
// extend this one exact provider request just far enough to cover that balance and the same overlap,
// bounded by SimpleFIN's documented 90-day maximum.
const SIMPLEFIN_HISTORY_WINDOW_SECONDS = 45 * 24 * 60 * 60;
const SIMPLEFIN_HISTORY_OVERLAP_SECONDS = 15 * 24 * 60 * 60;
const SIMPLEFIN_MAX_HISTORY_WINDOW_SECONDS = 90 * 24 * 60 * 60;
// A stable namespace for the PostgreSQL advisory lock used by SimpleFIN fetch leases.
const SIMPLEFIN_FETCH_LOCK_SEED = 0x53464e;

export interface SimpleFinHistoryPlan {
  historyRecovery?: HistoryRecoveryEvidence;
  previous?: ParsedTransactions;
  startDateEpoch: number;
}

export interface SimpleFinAccountsFetcher {
  fetchAccounts(accessUrl: string, request?: SimpleFinAccountsRequest): Promise<Uint8Array>;
}

export class ImportService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];
  private readonly access: AccessService;
  private readonly blobs: BlobStore;
  private readonly credentialCrypto: SourceCredentialCrypto;
  private readonly simpleFin: SimpleFinAccountsFetcher;

  constructor(
    context: ServiceContext & {
      blobs: BlobStore;
      credentialCrypto?: SourceCredentialCrypto;
      credentialEncryptionKey?: CredentialEncryptionKeys;
      simpleFin: SimpleFinAccountsFetcher;
    },
  ) {
    this.db = context.db;
    this.actor = context.actor;
    this.access = new AccessService(context);
    this.blobs = context.blobs;
    if (!context.credentialCrypto && !context.credentialEncryptionKey) {
      throw new Error("Credential crypto is required");
    }
    this.credentialCrypto =
      context.credentialCrypto ??
      createLocalSourceCredentialCrypto(context.credentialEncryptionKey!);
    this.simpleFin = context.simpleFin;
  }

  async startPreview(vibeUuid: string, input: CreateImportPreviewRequest): Promise<DbOperation> {
    await this.access.assertVibeOwner(vibeUuid);
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const [vibe] = await this.db.select().from(vibes).where(eq(vibes.uuid, vibeUuid));
    if (!vibe) throw notFound("Vibe");

    const sourceUuid = sourceUuidOf(input.source);
    const source = await this.snapshotSource(sourceUuid, vibe.ownerUuid);
    if (input.rebaseline === true && source.kind !== "credential") {
      throw new Problem(
        422,
        "schema_violation",
        "Rebaseline is only available for connected sources",
        "Remove rebaseline or select a SimpleFIN ingestion source",
      );
    }
    if (source.kind === "credential") {
      await this.historyPlanFor(source, input.rebaseline === true, undefined, true);
    }
    const operationUuid = uuidv7();
    const [operation] = await this.db
      .insert(operations)
      .values({
        uuid: operationUuid,
        kind: "pull",
        status: "queued",
        invokedBy: this.actor.subject,
        vibeUuid,
        request: {
          mode: "import_preview",
          source: input.source,
          rebaseline: input.rebaseline ?? false,
        },
      })
      .returning();
    if (!operation) throw new Error("Import preview operation insert did not return a row");

    queueMicrotask(() => {
      void this.runPreview(operationUuid, sourceUuid, vibe, input.rebaseline === true).catch(
        async (error: unknown) => {
          await this.db
            .update(operations)
            .set({
              status: "failed",
              error: error instanceof Error ? error.message : "Import preview failed",
              finishedAt: new Date(),
            })
            .where(eq(operations.uuid, operationUuid));
        },
      );
    });
    return operation;
  }

  async startPull(vibeUuid: string, input: PullVibeRequest): Promise<DbOperation> {
    const vibe = await this.access.assertVibeScope(vibeUuid, "pull");
    if (!vibe.pullConfig?.enabled || !vibe.pullConfig.sources?.length) {
      throw new Problem(
        422,
        "schema_violation",
        "Pull is not configured",
        "The Vibe must have an enabled pull configuration with at least one source",
      );
    }
    if (new Set(vibe.pullConfig.sources).size !== vibe.pullConfig.sources.length) {
      throw new Problem(
        422,
        "schema_violation",
        "Pull configuration is invalid",
        "Configured source identifiers must be unique",
      );
    }
    const sourceUuids = vibe.pullConfig.sources.map(sourceUuidOf);
    const exposeOwnerHistoryGap = this.actor.kind === "user" && this.actor.uuid === vibe.ownerUuid;
    for (const sourceUuid of sourceUuids) {
      const source = await this.snapshotSource(sourceUuid, vibe.ownerUuid);
      if (source.kind === "credential") {
        try {
          await this.historyPlanFor(source, false, undefined, exposeOwnerHistoryGap);
        } catch (error) {
          if (exposeOwnerHistoryGap) throw error;
          // Pull may be invoked by a delegated dMachine. Keep private banking timestamps and the
          // source identifier in the owner's response while retaining a typed recovery signal.
          throw redactSimpleFinHistoryGapForPull(error);
        }
      }
    }

    const operationUuid = uuidv7();
    const [operation] = await this.db
      .insert(operations)
      .values({
        uuid: operationUuid,
        kind: "pull",
        status: "queued",
        invokedBy: this.actor.subject,
        vibeUuid,
        request: {
          mode: "pull",
          dry_run: input.dry_run ?? false,
          sources: vibe.pullConfig.sources,
        },
      })
      .returning();
    if (!operation) throw new Error("Pull operation insert did not return a row");

    queueMicrotask(() => {
      void this.runPull(operationUuid, vibe).catch(async (error: unknown) => {
        await this.db
          .update(operations)
          .set({
            status: "failed",
            error: error instanceof Error ? error.message : "Pull failed",
            finishedAt: new Date(),
          })
          .where(eq(operations.uuid, operationUuid));
      });
    });
    return operation;
  }

  async confirm(vibeUuid: string, operationUuid: string): Promise<VibeAggregate> {
    await this.access.assertVibeOwner(vibeUuid);
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const actor = this.actor;

    await this.db.transaction(async (transaction: DatabaseTransaction) => {
      const [lockedVibe] = await transaction
        .select()
        .from(vibes)
        .where(and(eq(vibes.uuid, vibeUuid), eq(vibes.ownerUuid, actor.uuid)))
        .for("update");
      if (!lockedVibe) throw notFound("Vibe");
      const [operation] = await transaction
        .select()
        .from(operations)
        .where(eq(operations.uuid, operationUuid))
        .for("update");
      if (!operation) throw notFound("Operation");
      if (
        operation.kind !== "pull" ||
        operation.status !== "done" ||
        operation.vibeUuid !== vibeUuid ||
        operation.invokedBy !== actor.subject ||
        operation.request.mode !== "import_preview" ||
        operation.committedAt
      ) {
        throw invalidReview(
          "The preview is failed, consumed, belongs to another actor, or targets another Vibe",
        );
      }

      const result = importPreviewResult(operation.result);
      if (!result.verify.ok || result.review_digest !== operation.reviewDigest) {
        throw invalidReview("The preview did not pass VERIFY or its digest does not match");
      }
      const reviewedRebaseline = operation.request.rebaseline === true;
      if (reviewedRebaseline !== Boolean(result.verify.history_recovery)) {
        throw invalidReview("The preview history-recovery evidence does not match its request");
      }
      const sourceReference = operation.request.source;
      if (typeof sourceReference !== "string") throw invalidReview("The preview has no source");
      const resolved = await this.resolveSource(
        sourceUuidOf(sourceReference),
        lockedVibe.ownerUuid,
        transaction,
        "update",
      );
      if (resolved.sourceStateDigest !== result.source_digest) {
        throw invalidReview("The source or pinned parser changed after review");
      }
      if (result.verify.history_recovery && resolved.kind !== "credential") {
        throw invalidReview("History recovery is only valid for a connected source");
      }
      const stagedOrigin = await this.lockStagedOrigin(
        transaction,
        originUuidOf(result.staged_origin),
        lockedVibe.ownerUuid,
      );
      const stagedFetch =
        resolved.kind === "credential"
          ? await this.lockVerifiedFetch(
              transaction,
              operationUuid,
              resolved,
              stagedOrigin.uuid,
              result.source_digest,
            )
          : undefined;
      if (resolved.kind === "origin" && resolved.origin.uuid !== stagedOrigin.uuid) {
        throw invalidReview("The staged origin does not match the file source");
      }
      const expectedReviewDigest = await digest({
        candidates: result.candidates,
        elements: result.elements,
        verify: result.verify,
        source_digest: result.source_digest,
        staged_origin: result.staged_origin,
      });
      if (expectedReviewDigest !== result.review_digest) {
        throw invalidReview("The staged candidate set changed after review");
      }

      const stagedCandidates: StagedCandidate[] = [];
      for (const candidate of result.candidates) {
        const candidateElements = result.elements.filter(
          ({ object_uri }) => object_uri === candidate.uri,
        );
        assertCandidate(candidate, lockedVibe.ownerUuid, stagedOrigin.uuid, candidateElements);
        stagedCandidates.push({
          candidate,
          candidate_digest: await candidateSemanticDigest(candidate, candidateElements),
          elements: candidateElements,
          identity: await identityForCandidate(candidate),
          origin_uuid: stagedOrigin.uuid,
          source_uuid: resolved.source.uuid,
        });
      }
      if (
        new Set(stagedCandidates.map(({ identity }) => identity)).size !== stagedCandidates.length
      ) {
        throw invalidReview("The preview repeats a source identity");
      }

      const [existingBindings, memberships] = await Promise.all([
        transaction
          .select()
          .from(ingestionSourceObjects)
          .where(eq(ingestionSourceObjects.sourceUuid, resolved.source.uuid)),
        transaction.select().from(vibeMediaObjects).where(eq(vibeMediaObjects.vibeUuid, vibeUuid)),
      ]);
      const bindingByIdentity = new Map(
        existingBindings.map((binding) => [binding.identity, binding]),
      );
      const currentMembers = new Set(memberships.map(({ mediaObjectUuid }) => mediaObjectUuid));
      let nextPosition =
        memberships.reduce((maximum, membership) => Math.max(maximum, membership.position), -1) + 1;
      const addedObjectUris: string[] = [];

      for (const entry of stagedCandidates) {
        const existing = bindingByIdentity.get(entry.identity);
        let mediaObjectUuid = existing?.mediaObjectUuid;
        if (existing) {
          if (existing.candidateDigest !== entry.candidate_digest) {
            throw invalidReview("A previously imported source identity changed unexpectedly");
          }
          await transaction
            .update(ingestionSourceObjects)
            .set({ lastSeenAt: new Date() })
            .where(
              and(
                eq(ingestionSourceObjects.sourceUuid, resolved.source.uuid),
                eq(ingestionSourceObjects.identity, entry.identity),
              ),
            );
        } else {
          mediaObjectUuid = await this.persistCandidate(transaction, operationUuid, entry);
          await transaction.insert(ingestionSourceObjects).values({
            sourceUuid: resolved.source.uuid,
            identity: entry.identity,
            mediaObjectUuid,
            candidateDigest: entry.candidate_digest,
          });
        }
        if (!mediaObjectUuid) throw new Error("Import candidate has no MediaObject identity");
        if (!currentMembers.has(mediaObjectUuid)) {
          await transaction.insert(vibeMediaObjects).values({
            vibeUuid,
            mediaObjectUuid,
            position: nextPosition++,
          });
          currentMembers.add(mediaObjectUuid);
          addedObjectUris.push("rnet://object/" + mediaObjectUuid);
        }
      }

      const sourceId = "source:" + resolved.source.uuid;
      const currentSources = lockedVibe.pullConfig?.sources ?? [];
      const pullConfig: NonNullable<Vibe["pull"]> = {
        enabled: true,
        policy: lockedVibe.pullConfig?.policy ?? "append_new",
        sources: [...new Set([...currentSources, sourceId])],
        last_pulled_at: new Date().toISOString(),
      };
      const [updatedVibe] = await transaction
        .update(vibes)
        .set({ pullConfig, rev: sql`${vibes.rev} + 1` })
        .where(eq(vibes.uuid, vibeUuid))
        .returning();
      if (!updatedVibe) throw notFound("Vibe");
      const activeGrants = await transaction
        .select()
        .from(grants)
        .where(and(eq(grants.vibeUuid, vibeUuid), isNull(grants.revokedAt)));
      await transaction.insert(vibeRevisions).values({
        vibeUuid,
        rev: updatedVibe.rev,
        actor: actor.subject,
        snapshot: {
          title: updatedVibe.title,
          inferred: updatedVibe.inferred,
          pull_config: updatedVibe.pullConfig,
          grants: activeGrants.map((grant) => ({ subject: grant.subject, scope: grant.scopes })),
        },
        membershipDelta: {
          added: addedObjectUris,
          removed: [],
        },
      });
      await transaction
        .update(operations)
        .set({ committedAt: new Date() })
        .where(eq(operations.uuid, operationUuid));
      if (stagedFetch) await this.commitFetch(transaction, stagedFetch.uuid);
    });

    const [vibe] = await this.db.select().from(vibes).where(eq(vibes.uuid, vibeUuid));
    if (!vibe) throw notFound("Vibe");
    const [activeGrants, memberships] = await Promise.all([
      this.db
        .select()
        .from(grants)
        .where(and(eq(grants.vibeUuid, vibeUuid), isNull(grants.revokedAt))),
      this.db
        .select({ uuid: vibeMediaObjects.mediaObjectUuid })
        .from(vibeMediaObjects)
        .where(eq(vibeMediaObjects.vibeUuid, vibeUuid))
        .orderBy(vibeMediaObjects.position),
    ]);
    return { vibe, grants: activeGrants, mediaObjectUuids: memberships.map(({ uuid }) => uuid) };
  }

  private async runPreview(
    operationUuid: string,
    sourceUuid: string,
    vibe: DbVibe,
    rebaseline: boolean,
  ): Promise<void> {
    await this.db
      .update(operations)
      .set({ status: "running" })
      .where(and(eq(operations.uuid, operationUuid), eq(operations.status, "queued")));
    const resolved = await this.snapshotSource(sourceUuid, vibe.ownerUuid);
    const staged = await this.stageSource(resolved, vibe.ownerUuid, operationUuid, rebaseline);
    const candidates = staged.candidates.map(({ candidate }) => candidate);
    const elements = staged.candidates.flatMap(({ elements }) => elements);
    const stagedOrigin = "rnet://origin/" + staged.origin.uuid;
    const reviewDigest = await digest({
      candidates,
      elements,
      verify: staged.verify,
      source_digest: staged.sourceStateDigest,
      staged_origin: stagedOrigin,
    });
    const result: ImportPreviewResult = {
      candidates,
      elements,
      verify: staged.verify,
      source_digest: staged.sourceStateDigest,
      staged_origin: stagedOrigin,
      review_digest: reviewDigest,
    };
    await this.db
      .update(operations)
      .set({
        status: "done",
        result: { ...result },
        reviewDigest,
        error: null,
        finishedAt: new Date(),
      })
      .where(eq(operations.uuid, operationUuid));
  }

  private async runPull(operationUuid: string, initialVibe: DbVibe): Promise<void> {
    await this.db
      .update(operations)
      .set({ status: "running" })
      .where(and(eq(operations.uuid, operationUuid), eq(operations.status, "queued")));

    const sourceReferences = initialVibe.pullConfig?.sources ?? [];
    const staged: StagedCandidate[] = [];
    const captures: StagedSourceCapture[] = [];
    const sourceResults: PullSourceResult[] = [];
    for (const sourceReference of sourceReferences) {
      const resolved = await this.snapshotSource(
        sourceUuidOf(sourceReference),
        initialVibe.ownerUuid,
      );
      const parsed = await this.stageSource(resolved, initialVibe.ownerUuid, operationUuid, false);
      staged.push(...parsed.candidates);
      captures.push(parsed);
      sourceResults.push({ source: sourceReference, verify: parsed.verify });
    }

    const dryRun = Boolean(
      (
        await this.db
          .select({ request: operations.request })
          .from(operations)
          .where(eq(operations.uuid, operationUuid))
      )[0]?.request.dry_run,
    );
    await this.applyPull(
      operationUuid,
      initialVibe,
      sourceReferences,
      staged,
      captures,
      sourceResults,
      dryRun,
    );
  }

  private async stageSource(
    resolved: ResolvedSource,
    ownerUuid: string,
    operationUuid: string,
    rebaseline: boolean,
  ): Promise<StagedSourceCapture> {
    if (resolved.kind === "credential") {
      return this.stageCredentialSource(resolved, ownerUuid, operationUuid, rebaseline);
    }
    return this.stageOriginSource(resolved, ownerUuid);
  }

  private async stageOriginSource(
    resolved: ResolvedOriginSource,
    ownerUuid: string,
  ): Promise<StagedSourceCapture> {
    const parser = transactionParserFor(resolved.source.parser);
    if (!parser || parser.version !== resolved.source.parserVersion) {
      throw new Error("Pinned parser version is unavailable");
    }
    const blob = await this.blobs.get("origins", resolved.origin.contentHash);
    if (!blob) throw new Error("Origin payload is unavailable");
    const parsed = await parser.parse(blob.bytes);
    const verify = verifyTransactions(parsed);
    if (!verify.ok) {
      throw new Error("VERIFY rejected the candidate transaction set: " + failedChecks(verify));
    }
    return {
      candidates: await candidatesFromParsed(
        parsed,
        resolved.source,
        resolved.origin,
        ownerUuid,
        parser.version,
      ),
      kind: "origin",
      origin: resolved.origin,
      source: resolved.source,
      sourceStateDigest: resolved.sourceStateDigest,
      verify,
    };
  }

  private async stageCredentialSource(
    resolved: ResolvedCredentialSource,
    ownerUuid: string,
    operationUuid: string,
    rebaseline: boolean,
  ): Promise<StagedSourceCapture> {
    const reservation = await this.reserveCredentialFetch(resolved, ownerUuid, operationUuid);
    const reservedSource = reservation.resolved;
    const fetchUuid = reservation.fetchUuid;

    let phase: "fetch" | "parse" | "verify" | "candidate" = "fetch";
    let providerRequestStarted = false;
    try {
      const config = simpleFinConfig(reservedSource.source.config);
      const endDateEpoch = Math.floor(Date.now() / 1_000);
      const historyPlan = await this.historyPlanFor(reservedSource, rebaseline, endDateEpoch);
      const accessUrl = await this.credentialCrypto.open(
        reservedSource.credential.secret,
        credentialAssociatedData(
          reservedSource.credential.uuid,
          ownerUuid,
          reservedSource.credential.provider,
        ),
      );
      providerRequestStarted = true;
      const bytes = await this.simpleFin.fetchAccounts(accessUrl, {
        ...(config.accounts
          ? { accountIds: config.accounts.map(({ account_id }) => account_id) }
          : {}),
        startDateEpoch: historyPlan.startDateEpoch,
        endDateEpoch,
        includePending: config.include_pending === true,
      });
      // Persist the exact successful provider response before lease cleanup. If unlocking the
      // dedicated connection fails, the rate-counted response remains retained as an immutable
      // OriginArtifact instead of disappearing before the fetch ledger can record its failure.
      const origin = await storeOwnedOriginArtifact(
        { db: this.db, blobs: this.blobs },
        {
          ownerUuid,
          bytes,
          mime: "application/json",
          label: `simplefin-${fetchUuid}.json`,
        },
      );
      // Revocation may proceed once the exact response is durable. Parsing does not use the
      // credential and therefore does not need the lease.
      await reservation.release();
      const retrievedAt = new Date();
      const [fetched] = await this.db
        .update(ingestionSourceFetches)
        .set({ originUuid: origin.uuid, status: "fetched", retrievedAt })
        .where(
          and(
            eq(ingestionSourceFetches.uuid, fetchUuid),
            eq(ingestionSourceFetches.status, "fetching"),
          ),
        )
        .returning({ uuid: ingestionSourceFetches.uuid });
      if (!fetched) throw new Error("Connected fetch state changed unexpectedly");

      phase = "parse";
      const parser = transactionParserFor(reservedSource.source.parser);
      if (!parser || parser.version !== reservedSource.source.parserVersion) {
        throw new Error("Pinned parser version is unavailable");
      }
      const current = filterSimpleFinTransactions(await parser.parse(bytes), config);

      phase = "verify";
      const verify = verifyTransactions(current, {
        ...(historyPlan.previous ? { previous: historyPlan.previous } : {}),
        ...(historyPlan.previous ? { historyStartEpoch: historyPlan.startDateEpoch } : {}),
        ...(historyPlan.historyRecovery ? { historyRecovery: historyPlan.historyRecovery } : {}),
      });
      if (!verify.ok) {
        throw new Error(`VERIFY rejected the connected transaction set: ${failedChecks(verify)}`);
      }

      phase = "candidate";
      const candidates = await candidatesFromParsed(
        current,
        reservation.resolved.source,
        origin,
        ownerUuid,
        parser.version,
      );
      const verifiedAt = new Date();
      const [verified] = await this.db
        .update(ingestionSourceFetches)
        .set({ status: "verified", verifiedAt, errorCode: null })
        .where(
          and(
            eq(ingestionSourceFetches.uuid, fetchUuid),
            eq(ingestionSourceFetches.status, "fetched"),
          ),
        )
        .returning({ uuid: ingestionSourceFetches.uuid });
      if (!verified) throw new Error("Connected fetch state changed unexpectedly");
      return {
        candidates,
        fetchUuid,
        kind: "credential",
        origin,
        source: reservation.resolved.source,
        sourceStateDigest: reservation.resolved.sourceStateDigest,
        verify,
      };
    } catch (error) {
      // Preserve the provider/parser failure and ledger transition even if lease cleanup sees a
      // broken connection. A broken PostgreSQL session releases its advisory locks server-side.
      try {
        await reservation.release();
      } catch {
        // The original failure is more actionable and must not be masked by cleanup.
      }
      if (providerRequestStarted) {
        await this.db
          .update(ingestionSourceFetches)
          .set({ status: "rejected", errorCode: `${phase}_failed` })
          .where(
            and(
              eq(ingestionSourceFetches.uuid, fetchUuid),
              inArray(ingestionSourceFetches.status, ["fetching", "fetched", "verified"]),
            ),
          );
      } else {
        // Local/KMS credential failures happen before any provider traffic. Removing the
        // untouched reservation keeps the rolling limit tied to actual SimpleFIN attempts.
        await this.db
          .delete(ingestionSourceFetches)
          .where(
            and(
              eq(ingestionSourceFetches.uuid, fetchUuid),
              eq(ingestionSourceFetches.status, "fetching"),
            ),
          );
      }
      throw error;
    }
  }

  /** Loads the exact committed capture and derives one provider-bounded history request. */
  private async historyPlanFor(
    resolved: ResolvedCredentialSource,
    rebaseline: boolean,
    endDateEpoch = Math.floor(Date.now() / 1_000),
    exposeSource = false,
  ): Promise<SimpleFinHistoryPlan> {
    if (!resolved.baseline) {
      return planSimpleFinHistory(
        undefined,
        endDateEpoch,
        rebaseline,
        exposeSource ? `source:${resolved.source.uuid}` : undefined,
      );
    }
    const parser = transactionParserFor(resolved.source.parser);
    if (!parser || parser.version !== resolved.source.parserVersion) {
      throw new Error("Pinned parser version is unavailable");
    }
    const previousBlob = await this.blobs.get("origins", resolved.baseline.origin.contentHash);
    if (!previousBlob) throw new Error("Previous connected capture is unavailable");
    const previous = filterSimpleFinTransactions(
      await parser.parse(previousBlob.bytes),
      simpleFinConfig(resolved.source.config),
    );
    return planSimpleFinHistory(
      previous,
      endDateEpoch,
      rebaseline,
      exposeSource ? `source:${resolved.source.uuid}` : undefined,
    );
  }

  /**
   * Linearizes a provider fetch with credential revocation without holding a database
   * transaction open across the network. The short transaction locks and revalidates the
   * credential/source, takes a session advisory lease, checks the credential-wide rolling
   * quota, and durably records the attempt. A database trigger takes the matching transaction
   * advisory lock before revocation, so either revocation wins before reservation or waits for
   * the outbound request to finish. The reserved connection makes the lease crash-safe: its
   * session lock is released automatically if the process/connection dies.
   */
  private async reserveCredentialFetch(
    expected: ResolvedCredentialSource,
    ownerUuid: string,
    operationUuid: string,
  ): Promise<CredentialFetchReservation> {
    const connection = await this.db.$client.reserve();
    const fetchUuid = uuidv7();
    let leaseHeld = false;
    let connectionReleased = false;

    const release = async (): Promise<void> => {
      if (connectionReleased) return;
      try {
        if (leaseHeld) {
          // This connection is dedicated to one fetch lease. Unlocking every session lock is
          // safer than returning a connection with an uncertain lock state after an error.
          await connection`select pg_advisory_unlock_all()`;
          leaseHeld = false;
        }
      } finally {
        connection.release();
        connectionReleased = true;
      }
    };

    try {
      await connection`begin`;
      let reserved: ResolvedCredentialSource;
      try {
        const [locked] = await connection<
          Array<{
            credential_uuid: string;
            owner_uuid: string;
            provider: string;
            source_config: unknown;
            source_kind: string;
            source_parser: string;
            source_parser_version: string;
            source_uuid: string;
          }>
        >`
          select
            credential.uuid as credential_uuid,
            credential.user_uuid as owner_uuid,
            credential.provider,
            source.uuid as source_uuid,
            source.kind as source_kind,
            source.parser as source_parser,
            source.parser_version as source_parser_version,
            source.config as source_config
          from source_credentials as credential
          join ingestion_sources as source
            on source.credential_uuid = credential.uuid
            and source.owner_uuid = credential.user_uuid
          where credential.uuid = ${expected.credential.uuid}
            and credential.user_uuid = ${ownerUuid}
            and credential.revoked_at is null
            and source.uuid = ${expected.source.uuid}
            and source.kind = 'credential'
            and source.revoked_at is null
          for update of credential, source
        `;
        if (!locked) throw notFound("Ingestion source");

        const [baseline] = await connection<
          Array<{
            fetch_uuid: string;
            origin_content_hash: string;
            origin_uuid: string;
            parser_version: string;
          }>
        >`
          select
            source_fetch.uuid as fetch_uuid,
            source_fetch.parser_version,
            origin.uuid as origin_uuid,
            origin.content_hash as origin_content_hash
          from ingestion_source_fetches as source_fetch
          join origins as origin
            on origin.uuid = source_fetch.origin_uuid
            and origin.owner_uuid = source_fetch.owner_uuid
            and origin.tombstoned_at is null
          where source_fetch.source_uuid = ${expected.source.uuid}
            and source_fetch.status = 'committed'
            and source_fetch.origin_uuid is not null
            and source_fetch.committed_at is not null
          order by source_fetch.committed_at desc, source_fetch.created_at desc
          limit 1
          for update of source_fetch, origin
        `;
        const expectedBaseline = expected.baseline;
        if (
          locked.credential_uuid !== expected.credential.uuid ||
          locked.owner_uuid !== ownerUuid ||
          locked.provider !== expected.credential.provider ||
          locked.source_uuid !== expected.source.uuid ||
          locked.source_kind !== expected.source.kind ||
          locked.source_parser !== expected.source.parser ||
          locked.source_parser_version !== expected.source.parserVersion ||
          canonicalJson(locked.source_config ?? {}) !==
            canonicalJson(expected.source.config ?? {}) ||
          Boolean(baseline) !== Boolean(expectedBaseline) ||
          (baseline !== undefined &&
            (baseline.fetch_uuid !== expectedBaseline?.fetch.uuid ||
              baseline.parser_version !== expectedBaseline.fetch.parserVersion ||
              baseline.origin_uuid !== expectedBaseline.origin.uuid ||
              baseline.origin_content_hash !== expectedBaseline.origin.contentHash))
        ) {
          throw new Error("The connected source changed before its fetch could start");
        }
        const candidate = expected;

        // Credential/source row locks are acquired before this session lock, matching the
        // revocation transaction's row-lock-then-advisory-lock order and avoiding deadlocks.
        const [lock] = await connection<[{ acquired: boolean }]>`
          select pg_try_advisory_lock(
            hashtextextended(${candidate.credential.uuid}::text, ${SIMPLEFIN_FETCH_LOCK_SEED}::bigint)
          ) as acquired
        `;
        if (!lock?.acquired) {
          throw new Problem(
            429,
            "rate_limited",
            "SimpleFIN fetch already in progress",
            "Wait for the active credential fetch to finish before trying again",
          );
        }
        leaseHeld = true;

        const [recent] = await connection<Array<{ count: number }>>`
          select count(*)::int as count
          from ingestion_source_fetches
          where credential_uuid = ${candidate.credential.uuid}
            and created_at >= now() - make_interval(hours => ${SIMPLEFIN_FETCH_WINDOW_HOURS})
        `;
        assertSimpleFinFetchAllowance(recent?.count ?? 0);

        await connection`
          insert into ingestion_source_fetches (
            uuid,
            source_uuid,
            owner_uuid,
            credential_uuid,
            operation_uuid,
            parser_version,
            source_state_digest
          ) values (
            ${fetchUuid},
            ${candidate.source.uuid},
            ${ownerUuid},
            ${candidate.credential.uuid},
            ${operationUuid},
            ${candidate.source.parserVersion},
            ${candidate.sourceStateDigest}
          )
        `;
        reserved = candidate;
        await connection`commit`;
      } catch (error) {
        await connection`rollback`;
        throw error;
      }
      return { fetchUuid, release, resolved: reserved };
    } catch (error) {
      await release();
      throw error;
    }
  }

  private async applyPull(
    operationUuid: string,
    initialVibe: DbVibe,
    sourceReferences: string[],
    staged: StagedCandidate[],
    captures: StagedSourceCapture[],
    sourceResults: PullSourceResult[],
    dryRun: boolean,
  ): Promise<void> {
    await this.db.transaction(async (transaction: DatabaseTransaction) => {
      const [vibe] = await transaction
        .select()
        .from(vibes)
        .where(eq(vibes.uuid, initialVibe.uuid))
        .for("update");
      if (!vibe) throw notFound("Vibe");
      const currentSources = vibe.pullConfig?.sources ?? [];
      if (
        !vibe.pullConfig?.enabled ||
        canonicalJson(currentSources) !== canonicalJson(sourceReferences) ||
        vibe.pullConfig.policy !== initialVibe.pullConfig?.policy
      ) {
        throw new Error("The Vibe pull configuration changed while the pull was running");
      }

      const connectedFetches: DbIngestionSourceFetch[] = [];
      for (const capture of [...captures].sort((left, right) =>
        compareCodeUnits(left.source.uuid, right.source.uuid),
      )) {
        const resolved = await this.resolveSource(
          capture.source.uuid,
          vibe.ownerUuid,
          transaction,
          "update",
        );
        if (
          resolved.sourceStateDigest !== capture.sourceStateDigest ||
          resolved.source.parser !== capture.source.parser ||
          resolved.source.parserVersion !== capture.source.parserVersion
        ) {
          throw new Error("An ingestion source changed while the pull was running");
        }
        const stagedOrigin = await this.lockStagedOrigin(
          transaction,
          capture.origin.uuid,
          vibe.ownerUuid,
        );
        if (resolved.kind === "origin") {
          if (capture.kind !== "origin" || resolved.origin.uuid !== stagedOrigin.uuid) {
            throw new Error("The file source origin changed while the pull was running");
          }
        } else {
          if (capture.kind !== "credential" || !capture.fetchUuid) {
            throw new Error("The connected source capture is malformed");
          }
          connectedFetches.push(
            await this.lockVerifiedFetch(
              transaction,
              operationUuid,
              resolved,
              stagedOrigin.uuid,
              capture.sourceStateDigest,
              capture.fetchUuid,
            ),
          );
        }
      }

      const policy = vibe.pullConfig.policy ?? "append_new";
      const sourceUuids = sourceReferences.map(sourceUuidOf);
      const bindings = await transaction
        .select()
        .from(ingestionSourceObjects)
        .where(inArray(ingestionSourceObjects.sourceUuid, sourceUuids));
      const bindingByIdentity = new Map(
        bindings.map((binding) => [binding.sourceUuid + ":" + binding.identity, binding]),
      );
      const duplicateCount = staged.filter((entry) =>
        bindingByIdentity.has(entry.source_uuid + ":" + entry.identity),
      ).length;
      const result: PullOperationResult = {
        added_count: 0,
        candidate_count: staged.length,
        candidates:
          this.actor.kind === "user" && this.actor.uuid === vibe.ownerUuid
            ? staged.map(({ candidate }) => candidate)
            : [],
        elements:
          this.actor.kind === "user" && this.actor.uuid === vibe.ownerUuid
            ? staged.flatMap(({ elements }) => elements)
            : [],
        created_count: 0,
        dry_run: dryRun,
        duplicate_count: duplicateCount,
        policy,
        removed_count: 0,
        source_results: sourceResults,
      };

      if (dryRun || policy === "suggest_only") {
        await transaction
          .update(operations)
          .set({ status: "done", result: { ...result }, error: null, finishedAt: new Date() })
          .where(eq(operations.uuid, operationUuid));
        return;
      }

      const membershipRows = await transaction
        .select()
        .from(vibeMediaObjects)
        .where(eq(vibeMediaObjects.vibeUuid, vibe.uuid));
      const membersBefore = new Set(membershipRows.map(({ mediaObjectUuid }) => mediaObjectUuid));
      const sourceObjectUuids = new Set(bindings.map(({ mediaObjectUuid }) => mediaObjectUuid));
      const removedObjectUuids =
        policy === "replace"
          ? membershipRows
              .filter(({ mediaObjectUuid }) => sourceObjectUuids.has(mediaObjectUuid))
              .map(({ mediaObjectUuid }) => mediaObjectUuid)
          : [];
      if (removedObjectUuids.length > 0) {
        await transaction
          .delete(vibeMediaObjects)
          .where(
            and(
              eq(vibeMediaObjects.vibeUuid, vibe.uuid),
              inArray(vibeMediaObjects.mediaObjectUuid, removedObjectUuids),
            ),
          );
        result.removed_count = removedObjectUuids.length;
      }

      const remainingMemberships =
        policy === "replace"
          ? membershipRows.filter(({ mediaObjectUuid }) => !sourceObjectUuids.has(mediaObjectUuid))
          : membershipRows;
      let nextPosition =
        remainingMemberships.reduce(
          (maximum, membership) => Math.max(maximum, membership.position),
          -1,
        ) + 1;
      const currentMembers = new Set(
        remainingMemberships.map(({ mediaObjectUuid }) => mediaObjectUuid),
      );
      const attachedObjectUuids: string[] = [];

      for (const entry of staged) {
        const bindingKey = entry.source_uuid + ":" + entry.identity;
        const existing = bindingByIdentity.get(bindingKey);
        let mediaObjectUuid = existing?.mediaObjectUuid;
        if (!existing) {
          mediaObjectUuid = await this.persistCandidate(transaction, operationUuid, entry);
          await transaction.insert(ingestionSourceObjects).values({
            sourceUuid: entry.source_uuid,
            identity: entry.identity,
            mediaObjectUuid,
            candidateDigest: entry.candidate_digest,
          });
          result.created_count += 1;
        } else if (policy === "replace" && existing.candidateDigest !== entry.candidate_digest) {
          mediaObjectUuid = await this.persistCandidate(transaction, operationUuid, entry);
          await transaction
            .update(ingestionSourceObjects)
            .set({
              mediaObjectUuid,
              candidateDigest: entry.candidate_digest,
              lastSeenAt: new Date(),
            })
            .where(
              and(
                eq(ingestionSourceObjects.sourceUuid, entry.source_uuid),
                eq(ingestionSourceObjects.identity, entry.identity),
              ),
            );
          result.created_count += 1;
        } else {
          await transaction
            .update(ingestionSourceObjects)
            .set({ lastSeenAt: new Date() })
            .where(
              and(
                eq(ingestionSourceObjects.sourceUuid, entry.source_uuid),
                eq(ingestionSourceObjects.identity, entry.identity),
              ),
            );
        }
        if (!mediaObjectUuid) throw new Error("Pull candidate has no MediaObject identity");
        if (!currentMembers.has(mediaObjectUuid)) {
          await transaction.insert(vibeMediaObjects).values({
            vibeUuid: vibe.uuid,
            mediaObjectUuid,
            position: nextPosition++,
          });
          currentMembers.add(mediaObjectUuid);
          attachedObjectUuids.push(mediaObjectUuid);
          result.added_count += 1;
        }
      }

      const now = new Date();
      for (const fetch of connectedFetches) {
        await this.commitFetch(transaction, fetch.uuid, now);
      }
      const pullConfig: NonNullable<Vibe["pull"]> = {
        ...vibe.pullConfig,
        last_pulled_at: now.toISOString(),
      };
      const [updatedVibe] = await transaction
        .update(vibes)
        .set({ pullConfig, rev: sql`${vibes.rev} + 1` })
        .where(eq(vibes.uuid, vibe.uuid))
        .returning();
      if (!updatedVibe) throw notFound("Vibe");
      const activeGrants = await transaction
        .select()
        .from(grants)
        .where(and(eq(grants.vibeUuid, vibe.uuid), isNull(grants.revokedAt)));
      const membersAfter = new Set([...currentMembers]);
      await transaction.insert(vibeRevisions).values({
        vibeUuid: vibe.uuid,
        rev: updatedVibe.rev,
        actor: this.actor.subject,
        snapshot: {
          title: updatedVibe.title,
          inferred: updatedVibe.inferred,
          pull_config: updatedVibe.pullConfig,
          grants: activeGrants.map((grant) => ({ subject: grant.subject, scope: grant.scopes })),
        },
        membershipDelta: {
          added: attachedObjectUuids
            .filter((uuid) => !membersBefore.has(uuid))
            .map((uuid) => "rnet://object/" + uuid),
          removed: [...new Set(removedObjectUuids)]
            .filter((uuid) => !membersAfter.has(uuid))
            .map((uuid) => "rnet://object/" + uuid),
        },
      });
      await transaction
        .update(operations)
        .set({
          status: "done",
          result: { ...result },
          error: null,
          finishedAt: now,
          committedAt: now,
        })
        .where(eq(operations.uuid, operationUuid));
    });
  }

  private async persistCandidate(
    transaction: DatabaseTransaction,
    operationUuid: string,
    entry: StagedCandidate,
  ): Promise<string> {
    const candidate = entry.candidate;
    const ownerUuid = candidate.owner.slice("rnet://id/".length);
    assertCandidate(candidate, ownerUuid, entry.origin_uuid, entry.elements);
    for (const element of entry.elements) await assertStagedElementBlob(this.blobs, element);

    const mediaObjectUuid = candidate.uri.slice("rnet://object/".length);
    await transaction.insert(mediaObjects).values({
      uuid: mediaObjectUuid,
      ownerUuid,
      createdBy: "rhizome:ingest",
      type: candidate.type,
      keys: candidate.keys ?? {},
      source: candidate.source,
      inferred: {},
      extensions: Object.fromEntries(
        Object.entries(candidate).filter(([key]) => key.startsWith("x-")),
      ),
      rnetSchema: RNET_SCHEMA_VERSION,
    });
    await transaction.insert(mediaObjectOrigins).values({
      mediaObjectUuid,
      originArtifactUuid: entry.origin_uuid,
    });
    for (const [position, element] of entry.elements.entries()) {
      const mediaElementUuid = elementUuidOf(element.uri);
      await transaction.insert(mediaElements).values({
        uuid: mediaElementUuid,
        ownerUuid,
        contentHash: element.content_hash,
        kind: element.kind,
        mime: element.mime,
        byteSize: element.byte_size,
        rnetSchema: RNET_SCHEMA_VERSION,
        createdBy: "rhizome:ingest",
      });
      await transaction.insert(mediaObjectElements).values({
        mediaObjectUuid,
        mediaElementUuid,
        position,
      });
    }
    await transaction.insert(mediaObjectRevisions).values({
      mediaObjectUuid,
      block: "source",
      rev: 1,
      snapshot: candidate.source,
      actor: this.actor.subject,
      operationUuid,
    });
    return mediaObjectUuid;
  }

  private snapshotSource(sourceUuid: string, ownerUuid: string): Promise<ResolvedSource> {
    return this.db.transaction((transaction) =>
      this.resolveSource(sourceUuid, ownerUuid, transaction, "share"),
    );
  }

  private async resolveSource(
    sourceUuid: string,
    ownerUuid: string,
    database: DatabaseTransaction,
    lock: "share" | "update",
  ): Promise<ResolvedSource> {
    const [observedSource] = await database
      .select()
      .from(ingestionSources)
      .where(
        and(
          eq(ingestionSources.uuid, sourceUuid),
          eq(ingestionSources.ownerUuid, ownerUuid),
          isNull(ingestionSources.revokedAt),
        ),
      );
    if (!observedSource) throw notFound("Ingestion source");

    if (observedSource.kind === "credential") {
      if (!observedSource.credentialUuid || observedSource.originUuid) {
        throw new Error("Credential ingestion source is internally inconsistent");
      }
      // Credential first matches revocation's lock order. The source is locked second and
      // rechecked against the initially observed credential, closing the discovery race.
      const [credential] = await database
        .select()
        .from(sourceCredentials)
        .where(
          and(
            eq(sourceCredentials.uuid, observedSource.credentialUuid),
            eq(sourceCredentials.userUuid, ownerUuid),
            isNull(sourceCredentials.revokedAt),
          ),
        )
        .for(lock);
      if (!credential) throw notFound("Ingestion source");
      const [source] = await database
        .select()
        .from(ingestionSources)
        .where(
          and(
            eq(ingestionSources.uuid, sourceUuid),
            eq(ingestionSources.ownerUuid, ownerUuid),
            eq(ingestionSources.kind, "credential"),
            eq(ingestionSources.credentialUuid, credential.uuid),
            isNull(ingestionSources.revokedAt),
          ),
        )
        .for(lock);
      if (!source) throw notFound("Ingestion source");
      if (credential.provider !== SIMPLEFIN_PROVIDER || source.parser !== SIMPLEFIN_PARSER_NAME) {
        throw new Problem(
          422,
          "parser_unsupported",
          "Source provider unsupported",
          credential.provider,
        );
      }
      assertPinnedParser(source);

      const [baselineFetch] = await database
        .select()
        .from(ingestionSourceFetches)
        .where(
          and(
            eq(ingestionSourceFetches.sourceUuid, source.uuid),
            eq(ingestionSourceFetches.status, "committed"),
            isNotNull(ingestionSourceFetches.originUuid),
            isNotNull(ingestionSourceFetches.committedAt),
          ),
        )
        .orderBy(desc(ingestionSourceFetches.committedAt), desc(ingestionSourceFetches.createdAt))
        .limit(1)
        .for(lock);
      let baseline: ResolvedCredentialSource["baseline"];
      if (baselineFetch) {
        if (!baselineFetch.originUuid) {
          throw new Error("Committed connected fetch has no OriginArtifact");
        }
        const [origin] = await database
          .select()
          .from(originArtifacts)
          .where(
            and(
              eq(originArtifacts.uuid, baselineFetch.originUuid),
              eq(originArtifacts.ownerUuid, ownerUuid),
              isNull(originArtifacts.tombstonedAt),
            ),
          )
          .for(lock);
        if (!origin) throw notFound("Ingestion source");
        baseline = { fetch: baselineFetch, origin };
      }
      const sourceStateDigest = await credentialSourceStateDigest(source, credential, baseline);
      return { kind: "credential", source, credential, baseline, sourceStateDigest };
    }

    const [source] = await database
      .select()
      .from(ingestionSources)
      .where(
        and(
          eq(ingestionSources.uuid, sourceUuid),
          eq(ingestionSources.ownerUuid, ownerUuid),
          eq(ingestionSources.kind, "origin"),
          isNull(ingestionSources.revokedAt),
        ),
      )
      .for(lock);
    if (!source || !source.originUuid || source.credentialUuid) {
      throw notFound("Ingestion source");
    }

    const [origin] = await database
      .select()
      .from(originArtifacts)
      .where(
        and(
          eq(originArtifacts.uuid, source.originUuid),
          eq(originArtifacts.ownerUuid, ownerUuid),
          isNull(originArtifacts.tombstonedAt),
        ),
      )
      .for(lock);
    if (!origin) throw notFound("Ingestion source");
    assertPinnedParser(source);
    return {
      kind: "origin",
      source,
      origin,
      sourceStateDigest: await originSourceStateDigest(source, origin),
    };
  }

  private async lockStagedOrigin(
    transaction: DatabaseTransaction,
    originUuid: string,
    ownerUuid: string,
  ): Promise<DbOriginArtifact> {
    const [origin] = await transaction
      .select()
      .from(originArtifacts)
      .where(
        and(
          eq(originArtifacts.uuid, originUuid),
          eq(originArtifacts.ownerUuid, ownerUuid),
          isNull(originArtifacts.tombstonedAt),
        ),
      )
      .for("update");
    if (!origin) throw invalidReview("The staged OriginArtifact is unavailable");
    return origin;
  }

  private async lockVerifiedFetch(
    transaction: DatabaseTransaction,
    operationUuid: string,
    resolved: ResolvedCredentialSource,
    originUuid: string,
    sourceStateDigest: string,
    fetchUuid?: string,
  ): Promise<DbIngestionSourceFetch> {
    const conditions = [
      eq(ingestionSourceFetches.operationUuid, operationUuid),
      eq(ingestionSourceFetches.sourceUuid, resolved.source.uuid),
      eq(ingestionSourceFetches.originUuid, originUuid),
      eq(ingestionSourceFetches.parserVersion, resolved.source.parserVersion),
      eq(ingestionSourceFetches.sourceStateDigest, sourceStateDigest),
      eq(ingestionSourceFetches.status, "verified"),
    ];
    if (fetchUuid) conditions.push(eq(ingestionSourceFetches.uuid, fetchUuid));
    const [fetch] = await transaction
      .select()
      .from(ingestionSourceFetches)
      .where(and(...conditions))
      .for("update");
    if (!fetch) throw invalidReview("The connected capture is stale or unavailable");
    return fetch;
  }

  private async commitFetch(
    transaction: DatabaseTransaction,
    fetchUuid: string,
    committedAt = new Date(),
  ): Promise<void> {
    const [committed] = await transaction
      .update(ingestionSourceFetches)
      .set({ status: "committed", committedAt })
      .where(
        and(
          eq(ingestionSourceFetches.uuid, fetchUuid),
          eq(ingestionSourceFetches.status, "verified"),
        ),
      )
      .returning({ uuid: ingestionSourceFetches.uuid });
    if (!committed) throw invalidReview("The connected capture was already consumed");
  }
}

function sourceUuidOf(source: string): string {
  if (!source.match(new RegExp(SOURCE_ID_PATTERN))) {
    throw new Problem(
      422,
      "schema_violation",
      "Pull configuration is invalid",
      "Unsupported source identifier: " + source,
    );
  }
  return source.slice("source:".length);
}

const ORIGIN_URI_PATTERN = new RegExp(rnetUriPattern("origin"));

function originUuidOf(origin: string): string {
  if (!ORIGIN_URI_PATTERN.test(origin)) throw invalidReview("The staged origin is malformed");
  return origin.slice("rnet://origin/".length);
}

function assertPinnedParser(source: DbIngestionSource): void {
  const parser = transactionParserFor(source.parser);
  if (!parser) {
    throw new Problem(422, "parser_unsupported", "Parser unsupported", source.parser);
  }
  if (parser.version !== source.parserVersion) {
    throw new Problem(422, "parser_unsupported", "Pinned parser unavailable", source.parserVersion);
  }
}

async function originSourceStateDigest(
  source: DbIngestionSource,
  origin: DbOriginArtifact,
): Promise<string> {
  return digest({
    source: source.uuid,
    kind: source.kind,
    parser: source.parser,
    parser_version: source.parserVersion,
    config: source.config ?? {},
    origin: origin.uuid,
    content_hash: origin.contentHash,
  });
}

async function credentialSourceStateDigest(
  source: DbIngestionSource,
  credential: DbSourceCredential,
  baseline: ResolvedCredentialSource["baseline"],
): Promise<string> {
  return digest({
    source: source.uuid,
    kind: source.kind,
    parser: source.parser,
    parser_version: source.parserVersion,
    config: source.config ?? {},
    credential: credential.uuid,
    provider: credential.provider,
    baseline: baseline
      ? {
          fetch: baseline.fetch.uuid,
          parser_version: baseline.fetch.parserVersion,
          origin: baseline.origin.uuid,
          content_hash: baseline.origin.contentHash,
        }
      : null,
  });
}

function simpleFinConfig(value: unknown): SimpleFinSourceConfig {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored SimpleFIN source configuration is invalid");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "accounts" && key !== "include_pending")) {
    throw new Error("Stored SimpleFIN source configuration is invalid");
  }
  if (record.include_pending !== undefined && typeof record.include_pending !== "boolean") {
    throw new Error("Stored SimpleFIN source configuration is invalid");
  }
  let accounts: SimpleFinSourceConfig["accounts"];
  if (record.accounts !== undefined) {
    if (
      !Array.isArray(record.accounts) ||
      record.accounts.length === 0 ||
      record.accounts.length > 100
    ) {
      throw new Error("Stored SimpleFIN source configuration is invalid");
    }
    const seen = new Set<string>();
    accounts = record.accounts.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Stored SimpleFIN source configuration is invalid");
      }
      const selector = value as Record<string, unknown>;
      if (
        Object.keys(selector).some((key) => key !== "connection_id" && key !== "account_id") ||
        typeof selector.connection_id !== "string" ||
        selector.connection_id.length === 0 ||
        selector.connection_id.length > 512 ||
        typeof selector.account_id !== "string" ||
        selector.account_id.length === 0 ||
        selector.account_id.length > 512
      ) {
        throw new Error("Stored SimpleFIN source configuration is invalid");
      }
      const composite = JSON.stringify([selector.connection_id, selector.account_id]);
      if (seen.has(composite)) {
        throw new Error("Stored SimpleFIN source configuration is invalid");
      }
      seen.add(composite);
      return {
        connection_id: selector.connection_id,
        account_id: selector.account_id,
      };
    });
  }
  return {
    ...(accounts ? { accounts } : {}),
    ...(record.include_pending === undefined ? {} : { include_pending: record.include_pending }),
  };
}

/**
 * Plans one exact SimpleFIN response. The ordinary 45-day range grows to include the oldest
 * selected-account balance plus a 15-day overlap, but never exceeds the provider's documented
 * 90-day limit. Crossing that boundary requires a separately reviewed rebaseline preview.
 */
export function planSimpleFinHistory(
  previous: ParsedTransactions | undefined,
  endDateEpoch: number,
  rebaseline: boolean,
  ownerSource?: string,
): SimpleFinHistoryPlan {
  if (!Number.isSafeInteger(endDateEpoch) || endDateEpoch <= 0) {
    throw new Error("SimpleFIN history end date is invalid");
  }
  const rollingStart = Math.max(0, endDateEpoch - SIMPLEFIN_HISTORY_WINDOW_SECONDS);
  if (!previous) {
    if (rebaseline) {
      throw new Problem(
        422,
        "schema_violation",
        "SimpleFIN source has no baseline to replace",
        "Start a normal import preview for this new connected source",
      );
    }
    return { startDateEpoch: rollingStart };
  }

  const balances = previous.accountBalances ?? [];
  if (!balances.length) throw new Error("Previous connected capture has no account balances");
  const oldestBalanceAt = Math.min(...balances.map(({ balanceAtEpoch }) => balanceAtEpoch));
  if (!Number.isSafeInteger(oldestBalanceAt) || oldestBalanceAt <= 0) {
    throw new Error("Previous connected capture has an invalid balance date");
  }
  const preferredStart = Math.max(0, oldestBalanceAt - SIMPLEFIN_HISTORY_OVERLAP_SECONDS);
  const earliestSupportedStart = Math.max(0, endDateEpoch - SIMPLEFIN_MAX_HISTORY_WINDOW_SECONDS);
  const previousBalanceAt = new Date(oldestBalanceAt * 1_000).toISOString();

  if (rebaseline) {
    return {
      startDateEpoch: rollingStart,
      historyRecovery: {
        mode: "rebaseline",
        reason:
          oldestBalanceAt < earliestSupportedStart
            ? "simplefin_history_gap"
            : "unreconciled_backdated_activity",
        previous_balance_at: previousBalanceAt,
        history_resumes_at: new Date(rollingStart * 1_000).toISOString(),
      },
    };
  }

  if (oldestBalanceAt < earliestSupportedStart) {
    throw new Problem(
      422,
      "simplefin_history_gap",
      "SimpleFIN history gap requires review",
      `The previous connected balance at ${previousBalanceAt} cannot be reconciled inside SimpleFIN's 90-day retrieval limit. Start an import preview with rebaseline=true to review and acknowledge a new baseline; the omitted interval will not be imported automatically.`,
      {
        previous_balance_at: previousBalanceAt,
        earliest_supported_start: new Date(earliestSupportedStart * 1_000).toISOString(),
        recovery: "reviewed_rebaseline",
        ...(ownerSource ? { source: ownerSource } : {}),
      },
    );
  }

  return {
    previous,
    // Preserve the preferred 15-day overlap when possible, then shrink only the overlap as the
    // balance approaches the provider boundary. The balance interval itself is never omitted.
    startDateEpoch: Math.max(earliestSupportedStart, Math.min(rollingStart, preferredStart)),
  };
}

/** Removes owner-only banking timestamps/source references from pull errors visible to grantees. */
export function redactSimpleFinHistoryGapForPull(error: unknown): unknown {
  if (!(error instanceof Problem) || error.code !== "simplefin_history_gap") return error;
  return new Problem(
    422,
    "simplefin_history_gap",
    "SimpleFIN history gap requires owner review",
    "The connected source cannot be reconciled inside the provider history window. Its owner must review a rebaseline import preview.",
    { recovery: "owner_reviewed_rebaseline" },
  );
}

export function assertSimpleFinFetchAllowance(recentAttemptCount: number): void {
  if (!Number.isSafeInteger(recentAttemptCount) || recentAttemptCount < 0) {
    throw new Error("SimpleFIN fetch attempt count is invalid");
  }
  if (recentAttemptCount >= SIMPLEFIN_FETCH_LIMIT) {
    throw new Problem(
      429,
      "rate_limited",
      "SimpleFIN fetch limit reached",
      `This credential has already attempted ${SIMPLEFIN_FETCH_LIMIT} account fetches in the last ${SIMPLEFIN_FETCH_WINDOW_HOURS} hours`,
    );
  }
}

/** Applies the owner-selected composite account and pending policy deterministically. */
export function filterSimpleFinTransactions(
  parsed: ParsedTransactions,
  config: SimpleFinSourceConfig,
): ParsedTransactions {
  const selectedAccounts = config.accounts
    ? new Set(
        config.accounts.map(({ connection_id, account_id }) =>
          JSON.stringify([connection_id, account_id]),
        ),
      )
    : undefined;
  const hasProviderErrors =
    (parsed.providerErrors?.structured.length ?? 0) > 0 ||
    (parsed.providerErrors?.legacyCount ?? 0) > 0;
  if (selectedAccounts && !hasProviderErrors) {
    const returnedAccounts = new Set(
      (parsed.accountBalances ?? [])
        .map(({ accountIdentity }) => accountIdentity)
        .filter((identity): identity is string => Boolean(identity)),
    );
    const missingAccountCount = [...selectedAccounts].filter(
      (identity) => !returnedAccounts.has(identity),
    ).length;
    if (missingAccountCount > 0) {
      throw new Error(
        `SimpleFIN response omitted ${missingAccountCount} selected account${missingAccountCount === 1 ? "" : "s"}`,
      );
    }
  }
  const includesAccount = (accountIdentity: string | undefined): boolean =>
    Boolean(accountIdentity) &&
    (!selectedAccounts || selectedAccounts.has(accountIdentity as string));
  const transactions = parsed.transactions.filter(
    (transaction) =>
      includesAccount(transaction.accountIdentity) &&
      (config.include_pending === true || transaction.pending !== true),
  );
  const countByAccount = new Map<string, number>();
  for (const transaction of transactions) {
    const identity = transaction.accountIdentity!;
    countByAccount.set(identity, (countByAccount.get(identity) ?? 0) + 1);
  }
  const accountBalances: ParsedAccountBalance[] | undefined = parsed.accountBalances
    ?.filter((balance) => includesAccount(balance.accountIdentity))
    .map((balance) => ({
      ...balance,
      sourceRecordCount: countByAccount.get(balance.accountIdentity) ?? 0,
    }));
  return {
    ...parsed,
    transactions,
    sourceRecordCount: transactions.length,
    ...(accountBalances ? { accountBalances } : {}),
  };
}

function failedChecks(report: VerifyReport): string {
  const names = report.checks.filter(({ ok }) => !ok).map(({ name }) => name);
  return names.length ? names.join(", ") : "unknown_check";
}

async function candidatesFromParsed(
  parsed: ParsedTransactions,
  source: DbIngestionSource,
  origin: DbOriginArtifact,
  ownerUuid: string,
  parserVersion: string,
): Promise<StagedCandidate[]> {
  const candidates: StagedCandidate[] = [];
  for (const transaction of parsed.transactions) {
    const accountHash = await digest(transaction.accountIdentity ?? "default");
    const candidate: MediaObject = {
      rnet_schema: RNET_SCHEMA_VERSION,
      uri: "rnet://object/" + uuidv7(),
      owner: "rnet://id/" + ownerUuid,
      type: "transaction",
      elements: [],
      keys: {
        ...transaction.keys,
        ...(transaction.fitid ? { fitid: transaction.fitid } : {}),
        account_hash: accountHash,
      },
      source: {
        ingest: { method: "parser", reproducible: true, skill: parserVersion },
        origins: ["rnet://origin/" + origin.uuid],
        properties: {
          amount: transaction.amount,
          currency: transaction.currency,
          ...(transaction.postedAt ? { posted_at: transaction.postedAt } : {}),
          ...(transaction.rawDescription
            ? { raw_description: transaction.rawDescription.slice(0, 1024) }
            : {}),
          ...transaction.sourceProperties,
        },
      },
    };
    const validation = validateMediaObject(candidate);
    if (!validation.ok) {
      throw new Error(
        "Parser produced a nonconformant candidate: " +
          validation.issues.map((issue) => issue.instancePath + " " + issue.message).join(", "),
      );
    }
    candidates.push({
      candidate,
      candidate_digest: await candidateSemanticDigest(candidate, []),
      elements: [],
      identity: await identityForCandidate(candidate),
      origin_uuid: origin.uuid,
      source_uuid: source.uuid,
    });
  }
  return candidates;
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  return contentHash(bytes);
}

async function identityForCandidate(candidate: MediaObject): Promise<string> {
  const accountHash = candidate.keys?.account_hash ?? "default";
  const fitid = candidate.keys?.fitid;
  return digest(
    fitid
      ? { type: candidate.type, account_hash: accountHash, fitid }
      : {
          type: candidate.type,
          account_hash: accountHash,
          properties: candidate.source.properties,
        },
  );
}

/**
 * Identifies canonical source values independently of the candidate URI and capture event.
 * Element identity is content-based, so a provider can later mint fresh staged element URIs
 * without making an unchanged candidate appear changed.
 */
export function candidateSemanticDigest(
  candidate: MediaObject,
  elements: readonly StagedElement[] = [],
): Promise<string> {
  const { uri: _uri, source, elements: _elementUris, ...content } = candidate;
  const { origins: _origins, retrieved_at: _retrievedAt, properties, ...sourceIdentity } = source;
  // Account-level snapshots can change while the transaction itself is unchanged. They remain
  // on the persisted source provenance; only this semantic comparison projection omits them.
  const {
    account_balance: _accountBalance,
    account_balance_date: _accountBalanceDate,
    account_balance_date_epoch: _accountBalanceDateEpoch,
    simplefin_account_extra: _simpleFinAccountExtra,
    ...semanticProperties
  } = properties;
  const semanticSource = { ...sourceIdentity, properties: semanticProperties };
  const semanticElements = elements.map(({ role, kind, mime, byte_size, content_hash }) => ({
    role,
    kind,
    mime,
    byte_size,
    content_hash,
  }));
  return digest({ ...content, elements: semanticElements, source: semanticSource });
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => JSON.stringify(key) + ":" + canonicalJson(entry))
      .join(",") +
    "}"
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function importPreviewResult(value: unknown): ImportPreviewResult {
  if (!value || typeof value !== "object") throw invalidReview("The preview has no staged result");
  const result = value as Partial<ImportPreviewResult>;
  if (
    !Array.isArray(result.candidates) ||
    !Array.isArray(result.elements) ||
    !result.verify ||
    typeof result.source_digest !== "string" ||
    typeof result.staged_origin !== "string" ||
    typeof result.review_digest !== "string"
  ) {
    throw invalidReview("The staged result is malformed");
  }
  if (
    result.verify.history_recovery !== undefined &&
    !validHistoryRecoveryEvidence(result.verify.history_recovery)
  ) {
    throw invalidReview("The staged history-recovery evidence is malformed");
  }
  return result as ImportPreviewResult;
}

function validHistoryRecoveryEvidence(value: unknown): value is HistoryRecoveryEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  if (
    Object.keys(evidence).some(
      (key) =>
        key !== "mode" &&
        key !== "reason" &&
        key !== "previous_balance_at" &&
        key !== "history_resumes_at",
    ) ||
    evidence.mode !== "rebaseline" ||
    (evidence.reason !== "simplefin_history_gap" &&
      evidence.reason !== "unreconciled_backdated_activity") ||
    typeof evidence.previous_balance_at !== "string" ||
    typeof evidence.history_resumes_at !== "string"
  ) {
    return false;
  }
  return (
    isCanonicalIsoTimestamp(evidence.previous_balance_at) &&
    isCanonicalIsoTimestamp(evidence.history_resumes_at)
  );
}

function isCanonicalIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function assertCandidate(
  candidate: MediaObject,
  ownerUuid: string,
  originUuid: string,
  elements: readonly StagedElement[],
): void {
  const validation = validateMediaObject(candidate);
  if (!validation.ok) throw invalidReview("A staged candidate no longer validates");
  if (candidate.owner !== "rnet://id/" + ownerUuid) throw invalidReview("Candidate owner mismatch");
  if (
    candidate.source.origins.length !== 1 ||
    candidate.source.origins[0] !== "rnet://origin/" + originUuid
  ) {
    throw invalidReview("Candidate origin mismatch");
  }
  if (
    candidate.elements.length !== elements.length ||
    candidate.elements.some((uri, index) => elements[index]?.uri !== uri) ||
    new Set(candidate.elements).size !== candidate.elements.length
  ) {
    throw invalidReview("Candidate element order mismatch");
  }
  for (const element of elements) {
    if (
      element.object_uri !== candidate.uri ||
      !["title", "content", "preview"].includes(element.role) ||
      !ELEMENT_URI_PATTERN.test(element.uri) ||
      !/^sha256:[a-f0-9]{64}$/.test(element.content_hash) ||
      !Number.isSafeInteger(element.byte_size) ||
      element.byte_size < 0 ||
      !element.mime
    ) {
      throw invalidReview("A staged element manifest is malformed");
    }
  }
}

const ELEMENT_URI_PATTERN = new RegExp(rnetUriPattern("element"));

function elementUuidOf(uri: string): string {
  if (!ELEMENT_URI_PATTERN.test(uri)) throw invalidReview("A staged element URI is malformed");
  return uri.slice("rnet://element/".length);
}

async function assertStagedElementBlob(blobs: BlobStore, element: StagedElement): Promise<void> {
  const blob = await blobs.get("elements", element.content_hash);
  if (
    !blob ||
    blob.bytes.byteLength !== element.byte_size ||
    (await contentHash(blob.bytes)) !== element.content_hash
  ) {
    throw invalidReview("A staged element payload is unavailable or changed");
  }
}

function invalidReview(detail: string): Problem {
  return new Problem(422, "import_review_invalid", "Import review invalid", detail);
}
