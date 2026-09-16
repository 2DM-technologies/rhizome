import { rnetUriPattern, validateMediaObject, type MediaObject, type Vibe } from "@rnet/types";
import {
  SOURCE_ID_PATTERN,
  type ConfirmPendingVibeImportRequest,
  type CreateImportPreviewRequest,
  type CreatePendingVibeImportRequest,
  type PullVibeRequest,
  type SourceExecutionLimits,
} from "@rhizome/store-contract";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { FileSourceCatalog, FileSourceSkill } from "../../../ingest/file-sources/types.ts";
import type {
  PublicRemoteSourceCatalog,
  PublicRemoteSourceSkill,
} from "../../../ingest/public-sources/types.ts";
import {
  CANDIDATE_BUNDLE_CAPABILITY,
  type CandidateBundle,
  type CandidateBundleCapability,
  type SourceCandidateDraft,
  type SourceJsonObject,
  type SourceJsonValue,
  type SourceVerifyReport,
} from "../../../ingest/source-skills/candidate-bundle.ts";
import {
  assertCandidateBundleLimits,
  assertCaptureLimit,
} from "../../../ingest/source-skills/execution-limits.ts";
import {
  ConnectedSourceActionRequired,
  ConnectedSourceError,
  CredentialConnectionError,
  CredentialedSourceCatalog,
  connectedSourceOperationResult,
  delegatedConnectedSourceError,
  type ConnectedSourceActionEvidence,
  type ConnectedSourceActionKind,
  type CredentialedSourceSkill,
  type PreparedConnectedSourceFetch,
} from "../../../ingest/connected-sources/types.ts";
import type { BlobStore } from "../blobs/index.ts";
import { contentHash } from "../blobs/content.ts";
import type { Database, DatabaseTransaction, ProviderLeasePool } from "../db/index.ts";
import { grants } from "../db/models/grant.ts";
import {
  ingestionSourceFetches,
  type DbIngestionSourceFetch,
} from "../db/models/ingestion-source-fetch.ts";
import { ingestionSources, type DbIngestionSource } from "../db/models/ingestion-source.ts";
import { ingestionSourceObjects } from "../db/models/ingestion-source-object.ts";
import { mediaElements, type MediaElementKind } from "../db/models/media-element.ts";
import {
  MediaObjectElementRoleEnum,
  mediaObjectElements,
  type MediaObjectElementRole,
} from "../db/models/media-object-element.ts";
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
import { RNET_SCHEMA_VERSION, STORE_ACTOR } from "../rnet.ts";
import type { VibeAggregate } from "../serializers/vibe-serializer.ts";
import { AccessService } from "./access-service.ts";
import { CREDENTIAL_FETCH_LOCK_SEED } from "./credential-lease.ts";
import {
  sourceCaptureProviderTimeoutMilliseconds,
  withProviderRequestDeadline,
} from "./provider-request-deadline.ts";
import { storeOwnedOriginArtifact } from "./origin-artifact-service.ts";
import {
  createLocalSourceCredentialCrypto,
  credentialAssociatedData,
  type CredentialEncryptionKeys,
  type SourceCredentialCrypto,
} from "./source-credential-crypto.ts";
import { publicMetadataForStorage } from "./source-credential-service.ts";
import {
  SourceContinuationCodec,
  type ConnectedSourceContinuation,
} from "./source-continuation.ts";
import type { ServiceContext } from "./types.ts";

interface ImportPreviewResult {
  action_evidence?: ConnectedSourceActionEvidence;
  candidates: MediaObject[];
  candidate_metadata: StagedCandidateMetadata[];
  elements: StagedElement[];
  verify: SourceVerifyReport;
  source_digest: string;
  staged_origin: string;
  review_digest: string;
  destination?: { title: string };
}

interface StagedCandidate {
  candidate: MediaObject;
  candidate_digest: string;
  elements: StagedElement[];
  identity: string;
  origin_uuid: string;
  semantic_identity: SourceJsonValue;
  semantic_source_properties: SourceJsonObject;
  source_uuid: string;
}

interface StagedCandidateMetadata {
  object_uri: string;
  semantic_identity: SourceJsonValue;
  semantic_source_properties: SourceJsonObject;
}

interface PullSourceResult {
  source: string;
  verify: SourceVerifyReport;
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
  skill: CredentialedSourceSkill;
  baseline?: {
    fetch: DbIngestionSourceFetch;
    origin: DbOriginArtifact;
  };
}

interface ResolvedRemoteSource extends ResolvedSourceBase {
  kind: "remote";
  skill: PublicRemoteSourceSkill;
}

type ResolvedSource = ResolvedOriginSource | ResolvedCredentialSource | ResolvedRemoteSource;

/**
 * A provider-neutral manifest for a payload captured during preview. Sources can emit zero or
 * more elements through this same reviewed and atomically committed path.
 */
export interface StagedElement {
  uri: string;
  object_uri: string;
  role: MediaObjectElementRole;
  alt?: string;
  kind: MediaElementKind;
  mime: string;
  byte_size: number;
  content_hash: string;
  preview_url: string;
}

interface StagedSourceCapture {
  actionEvidence?: ConnectedSourceActionEvidence;
  candidates: StagedCandidate[];
  fetchUuid?: string;
  kind: "origin" | "credential" | "remote";
  origin: DbOriginArtifact;
  source: DbIngestionSource;
  sourceStateDigest: string;
  verify: SourceVerifyReport;
  destination?: { title: string };
}

interface CredentialFetchReservation {
  fetchUuid: string;
  release: () => Promise<void>;
  resolved: ResolvedCredentialSource;
  updateCredential(input: {
    secret: Uint8Array;
    publicMetadata?: SourceJsonObject;
  }): Promise<boolean>;
}

interface PublicRemoteFetchReservation {
  fetchUuid: string;
  release: () => Promise<void>;
  resolved: ResolvedRemoteSource;
}

// Stable namespace for owner-and-skill public-remote fetch leases.
const PUBLIC_REMOTE_FETCH_LOCK_SEED = 0x505542;

export class ImportService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];
  private readonly access: AccessService;
  private readonly blobs: BlobStore;
  private readonly credentialCrypto: SourceCredentialCrypto;
  private readonly credentialedSources: CredentialedSourceCatalog;
  private readonly fileSources: FileSourceCatalog;
  private readonly publicRemoteSources: PublicRemoteSourceCatalog;
  private readonly providerLeasePool: ProviderLeasePool;
  private readonly baseUrl: string;
  private readonly sourceContinuations: SourceContinuationCodec;

  constructor(
    context: ServiceContext & {
      blobs: BlobStore;
      credentialedSources: CredentialedSourceCatalog;
      fileSources: FileSourceCatalog;
      publicRemoteSources: PublicRemoteSourceCatalog;
      providerLeasePool: ProviderLeasePool;
      baseUrl: string;
      credentialCrypto?: SourceCredentialCrypto;
      credentialEncryptionKey?: CredentialEncryptionKeys;
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
    this.sourceContinuations = new SourceContinuationCodec(this.credentialCrypto);
    this.credentialedSources = context.credentialedSources;
    this.fileSources = context.fileSources;
    this.publicRemoteSources = context.publicRemoteSources;
    this.providerLeasePool = context.providerLeasePool;
    this.baseUrl = context.baseUrl.replace(/\/$/, "");
  }

  async startPreview(vibeUuid: string, input: CreateImportPreviewRequest): Promise<DbOperation> {
    await this.access.assertVibeOwner(vibeUuid);
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const [vibe] = await this.db.select().from(vibes).where(eq(vibes.uuid, vibeUuid));
    if (!vibe) throw notFound("Vibe");
    return this.startPreviewForVibe({
      vibe,
      operationVibeUuid: vibe.uuid,
      invokedBy: this.actor.subject,
      sourceReference: input.source,
      continuationToken: input.continuation_token,
      pendingDestination: false,
    });
  }

  async startPendingVibePreview(input: CreatePendingVibeImportRequest): Promise<DbOperation> {
    await this.access.assertAuthenticated();
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const actor = this.actor;
    const pendingVibeUuid = input.destination?.id ?? uuidv7();
    const pendingVibe: DbVibe = {
      uuid: pendingVibeUuid,
      title: "Pending import",
      ownerUuid: actor.uuid,
      rnetSchema: RNET_SCHEMA_VERSION,
      inferred: {},
      pullConfig: null,
      extensions: {},
      createdAt: new Date(),
      rev: 0,
    };
    return this.startPreviewForVibe({
      vibe: pendingVibe,
      operationVibeUuid: null,
      invokedBy: actor.subject,
      sourceReference: input.source,
      continuationToken: input.continuation_token,
      pendingDestination: true,
    });
  }

  private async startPreviewForVibe(input: {
    continuationToken: string | undefined;
    invokedBy: string;
    operationVibeUuid: string | null;
    pendingDestination: boolean;
    sourceReference: string;
    vibe: DbVibe;
  }): Promise<DbOperation> {
    const sourceUuid = sourceUuidOf(input.sourceReference);
    const source = await this.snapshotSource(sourceUuid, input.vibe.ownerUuid);
    const continuation = input.continuationToken
      ? await this.openSourceContinuation(
          input.continuationToken,
          input.vibe.uuid,
          input.vibe.ownerUuid,
          source,
        )
      : undefined;
    if (source.kind === "credential") {
      try {
        await this.prepareConnectedFetch(source, continuation?.resume);
      } catch (error) {
        if (!(error instanceof ConnectedSourceActionRequired)) throw error;
        if (continuation) throw invalidContinuation();
        throw await this.sourceActionError(error, source, input.vibe, input.pendingDestination);
      }
    } else if (continuation) {
      throw invalidContinuation();
    }
    const operationUuid = uuidv7();
    const [operation] = await this.db
      .insert(operations)
      .values({
        uuid: operationUuid,
        kind: "pull",
        status: "queued",
        invokedBy: input.invokedBy,
        ownerUuid: input.vibe.ownerUuid,
        vibeUuid: input.operationVibeUuid,
        request: {
          mode: "import_preview",
          source: input.sourceReference,
          ...(input.pendingDestination
            ? { pending_destination: { vibe_uuid: input.vibe.uuid } }
            : {}),
          ...(continuation ? { continuation_action: continuation.kind } : {}),
        },
      })
      .returning();
    if (!operation) throw new Error("Import preview operation insert did not return a row");

    queueMicrotask(() => {
      void this.runPreview(operationUuid, sourceUuid, input.vibe, continuation).catch(
        async (error: unknown) => {
          await this.db
            .update(operations)
            .set({
              status: "failed",
              result: connectedSourceOperationResult(error),
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
    const exposeOwnerAction = this.actor.kind === "user" && this.actor.uuid === vibe.ownerUuid;
    for (const sourceUuid of sourceUuids) {
      const source = await this.snapshotSource(sourceUuid, vibe.ownerUuid);
      if (source.kind === "credential") {
        try {
          await this.prepareConnectedFetch(source);
        } catch (error) {
          if (error instanceof ConnectedSourceActionRequired) {
            if (exposeOwnerAction) throw await this.sourceActionError(error, source, vibe);
            throw delegatedSourceActionError(error.skillId);
          }
          throw delegatedConnectedSourceError(error);
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
        ownerUuid: vibe.ownerUuid,
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
            result: connectedSourceOperationResult(error),
            error: error instanceof Error ? error.message : "Pull failed",
            finishedAt: new Date(),
          })
          .where(eq(operations.uuid, operationUuid));
      });
    });
    return operation;
  }

  async confirm(
    existingVibeUuid: string | undefined,
    operationUuid: string,
    pendingDestination?: ConfirmPendingVibeImportRequest,
  ): Promise<VibeAggregate & { addedObjectUris: string[] }> {
    if (existingVibeUuid) await this.access.assertVibeOwner(existingVibeUuid);
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const actor = this.actor;
    let committedVibeUuid = existingVibeUuid;
    const addedObjectUris: string[] = [];

    await this.db.transaction(async (transaction: DatabaseTransaction) => {
      let operation: DbOperation | undefined;
      let lockedVibe: DbVibe | undefined;
      if (existingVibeUuid) {
        [lockedVibe] = await transaction
          .select()
          .from(vibes)
          .where(and(eq(vibes.uuid, existingVibeUuid), eq(vibes.ownerUuid, actor.uuid)))
          .for("update");
        if (!lockedVibe) throw notFound("Vibe");
        [operation] = await transaction
          .select()
          .from(operations)
          .where(eq(operations.uuid, operationUuid))
          .for("update");
      } else {
        [operation] = await transaction
          .select()
          .from(operations)
          .where(eq(operations.uuid, operationUuid))
          .for("update");
        if (!operation) throw notFound("Operation");
        const pendingVibeUuid = pendingDestinationUuid(operation.request);
        if (!pendingDestination || !pendingVibeUuid || operation.vibeUuid !== null) {
          throw invalidReview("The preview does not target a pending Vibe");
        }
        const [existing] = await transaction
          .select({ uuid: vibes.uuid })
          .from(vibes)
          .where(eq(vibes.uuid, pendingVibeUuid))
          .for("update");
        if (existing) throw invalidReview("The pending Vibe destination already exists");
        [lockedVibe] = await transaction
          .insert(vibes)
          .values({
            uuid: pendingVibeUuid,
            title: pendingDestination.title,
            ownerUuid: actor.uuid,
            rnetSchema: RNET_SCHEMA_VERSION,
            inferred: {},
            pullConfig: null,
            extensions: {},
            rev: 0,
          })
          .returning();
        committedVibeUuid = pendingVibeUuid;
      }
      if (!operation) throw notFound("Operation");
      if (!lockedVibe) throw new Error("Import destination was not resolved");
      const vibeUuid = lockedVibe.uuid;
      if (
        operation.kind !== "pull" ||
        operation.status !== "done" ||
        operation.vibeUuid !== (existingVibeUuid ? vibeUuid : null) ||
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
      const continuationAction = operationContinuationAction(operation.request);
      if (continuationAction !== result.action_evidence?.kind) {
        throw invalidReview("The preview action evidence does not match its continuation");
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
      if (result.action_evidence && resolved.kind !== "credential") {
        throw invalidReview("Reviewed actions are only valid for a connected source");
      }
      if (result.action_evidence && resolved.kind === "credential") {
        assertDeclaredReviewAction(resolved.skill, result.action_evidence.kind);
      }
      const stagedOrigin = await this.lockStagedOrigin(
        transaction,
        originUuidOf(result.staged_origin),
        lockedVibe.ownerUuid,
      );
      const stagedFetch =
        resolved.kind !== "origin"
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
        ...(result.action_evidence ? { action_evidence: result.action_evidence } : {}),
        ...(result.destination ? { destination: result.destination } : {}),
        candidates: result.candidates,
        candidate_metadata: result.candidate_metadata,
        elements: result.elements,
        verify: result.verify,
        source_digest: result.source_digest,
        staged_origin: result.staged_origin,
      });
      if (expectedReviewDigest !== result.review_digest) {
        throw invalidReview("The staged candidate set changed after review");
      }

      const stagedCandidates: StagedCandidate[] = [];
      const metadataByObjectUri = new Map(
        result.candidate_metadata.map((metadata) => [metadata.object_uri, metadata]),
      );
      for (const candidate of result.candidates) {
        const metadata = metadataByObjectUri.get(candidate.uri);
        if (!metadata) throw invalidReview("The preview is missing candidate metadata");
        const candidateElements = result.elements.filter(
          ({ object_uri }) => object_uri === candidate.uri,
        );
        assertCandidate(candidate, lockedVibe.ownerUuid, stagedOrigin.uuid, candidateElements);
        stagedCandidates.push({
          candidate,
          candidate_digest: await candidateSemanticDigest(
            candidate,
            candidateElements,
            () => metadata.semantic_source_properties,
          ),
          elements: candidateElements,
          identity: await digest(metadata.semantic_identity),
          origin_uuid: stagedOrigin.uuid,
          semantic_identity: metadata.semantic_identity,
          semantic_source_properties: metadata.semantic_source_properties,
          source_uuid: resolved.source.uuid,
        });
      }
      if (metadataByObjectUri.size !== stagedCandidates.length) {
        throw invalidReview("The preview contains unreferenced candidate metadata");
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
        .set({ committedAt: new Date(), vibeUuid })
        .where(eq(operations.uuid, operationUuid));
      if (stagedFetch) await this.commitFetch(transaction, stagedFetch.uuid);
    });

    if (!committedVibeUuid) throw new Error("Import confirmation did not resolve a destination");
    const vibeUuid = committedVibeUuid;
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
    return {
      vibe,
      grants: activeGrants,
      mediaObjectUuids: memberships.map(({ uuid }) => uuid),
      addedObjectUris,
    };
  }

  private async runPreview(
    operationUuid: string,
    sourceUuid: string,
    vibe: DbVibe,
    continuation?: ConnectedSourceContinuation,
  ): Promise<void> {
    await this.db
      .update(operations)
      .set({ status: "running" })
      .where(and(eq(operations.uuid, operationUuid), eq(operations.status, "queued")));
    const resolved = await this.snapshotSource(sourceUuid, vibe.ownerUuid);
    if (continuation && continuation.expectedSourceStateDigest !== resolved.sourceStateDigest) {
      throw invalidContinuation();
    }
    let staged: StagedSourceCapture;
    try {
      staged = await this.stageSource(resolved, vibe.ownerUuid, operationUuid, continuation);
    } catch (error) {
      if (!(error instanceof ConnectedSourceActionRequired) || resolved.kind !== "credential") {
        throw error;
      }
      if (continuation) throw invalidContinuation();
      throw await this.sourceActionError(error, resolved, vibe);
    }
    const candidates = staged.candidates.map(({ candidate }) => candidate);
    const candidateMetadata = staged.candidates.map(
      ({ candidate, semantic_identity, semantic_source_properties }): StagedCandidateMetadata => ({
        object_uri: candidate.uri,
        semantic_identity,
        semantic_source_properties,
      }),
    );
    const elements = staged.candidates.flatMap(({ elements }) => elements);
    const stagedOrigin = "rnet://origin/" + staged.origin.uuid;
    const reviewDigest = await digest({
      ...(staged.actionEvidence ? { action_evidence: staged.actionEvidence } : {}),
      ...(staged.destination ? { destination: staged.destination } : {}),
      candidates,
      candidate_metadata: candidateMetadata,
      elements,
      verify: staged.verify,
      source_digest: staged.sourceStateDigest,
      staged_origin: stagedOrigin,
    });
    const result: ImportPreviewResult = {
      ...(staged.actionEvidence ? { action_evidence: staged.actionEvidence } : {}),
      ...(staged.destination ? { destination: staged.destination } : {}),
      candidates,
      candidate_metadata: candidateMetadata,
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
      let parsed: StagedSourceCapture;
      try {
        parsed = await this.stageSource(resolved, initialVibe.ownerUuid, operationUuid);
      } catch (error) {
        if (!(error instanceof ConnectedSourceActionRequired) || resolved.kind !== "credential") {
          throw error;
        }
        throw await this.sourceActionError(error, resolved, initialVibe);
      }
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
    continuation?: ConnectedSourceContinuation,
  ): Promise<StagedSourceCapture> {
    if (resolved.kind === "credential") {
      return this.stageCredentialSource(resolved, ownerUuid, operationUuid, continuation);
    }
    if (resolved.kind === "remote") {
      if (continuation) throw invalidContinuation();
      return this.stagePublicRemoteSource(resolved, ownerUuid, operationUuid);
    }
    if (continuation) throw invalidContinuation();
    return this.stageOriginSource(resolved, ownerUuid, operationUuid);
  }

  private async stagePublicRemoteSource(
    resolved: ResolvedRemoteSource,
    ownerUuid: string,
    operationUuid: string,
  ): Promise<StagedSourceCapture> {
    const reservation = await this.reservePublicRemoteFetch(resolved, ownerUuid, operationUuid);
    const reservedSource = reservation.resolved;
    const fetchUuid = reservation.fetchUuid;
    const config = reservedSource.skill.parseConfig(reservedSource.source.config);
    let phase: "fetch" | "parse" | "verify" | "candidate" = "fetch";
    try {
      const bytes = await reservedSource.skill.retrieve(config);
      assertCaptureLimit(bytes.byteLength, reservedSource.source.executionLimits);
      // Provider bytes are now immutable in memory; release the provider-pool session before
      // ordinary database/blob persistence so the bounded provider pool gates only network I/O.
      await reservation.release();
      // Public data is still staged immutably before any parser or verifier runs.
      const origin = await storeOwnedOriginArtifact(
        { db: this.db, blobs: this.blobs },
        {
          ownerUuid,
          bytes,
          mime: reservedSource.skill.capture.mime,
          label: reservedSource.skill.capture.label(config, fetchUuid),
        },
      );
      const [fetched] = await this.db
        .update(ingestionSourceFetches)
        .set({ originUuid: origin.uuid, status: "fetched", retrievedAt: new Date() })
        .where(
          and(
            eq(ingestionSourceFetches.uuid, fetchUuid),
            eq(ingestionSourceFetches.status, "fetching"),
          ),
        )
        .returning({ uuid: ingestionSourceFetches.uuid });
      if (!fetched) throw new Error("Public-remote fetch state changed unexpectedly");

      phase = "parse";
      const bundle = await compileCandidateBundle(
        reservedSource.skill.compiledSource,
        {
          bytes,
          config,
          limits: reservedSource.source.executionLimits,
        },
        reservedSource.source.executionLimits,
      );
      phase = "verify";
      assertVerifiedCandidateBundle(bundle, reservedSource.skill.compiledSource);
      phase = "candidate";
      const candidates = await candidatesFromBundle(
        bundle,
        reservedSource.source,
        origin,
        ownerUuid,
        operationUuid,
        reservedSource.skill.parser.version,
        this.baseUrl,
        this.blobs,
      );
      const [verified] = await this.db
        .update(ingestionSourceFetches)
        .set({ status: "verified", verifiedAt: new Date(), errorCode: null })
        .where(
          and(
            eq(ingestionSourceFetches.uuid, fetchUuid),
            eq(ingestionSourceFetches.status, "fetched"),
          ),
        )
        .returning({ uuid: ingestionSourceFetches.uuid });
      if (!verified) throw new Error("Public-remote fetch state changed unexpectedly");
      return {
        candidates,
        ...(bundle.destination ? { destination: bundle.destination } : {}),
        fetchUuid,
        kind: "remote",
        origin,
        source: reservedSource.source,
        sourceStateDigest: reservedSource.sourceStateDigest,
        verify: bundle.verify,
      };
    } catch (error) {
      try {
        await reservation.release();
      } catch {
        // Preserve the fetch/parser failure if cleanup also fails.
      }
      await this.db
        .update(ingestionSourceFetches)
        .set({ status: "rejected", errorCode: `${phase}_failed` })
        .where(
          and(
            eq(ingestionSourceFetches.uuid, fetchUuid),
            inArray(ingestionSourceFetches.status, ["fetching", "fetched", "verified"]),
          ),
        );
      throw error;
    }
  }

  private async stageOriginSource(
    resolved: ResolvedOriginSource,
    ownerUuid: string,
    operationUuid: string,
  ): Promise<StagedSourceCapture> {
    const skill = assertPinnedFileSkill(resolved.source, this.fileSources);
    const blob = await this.blobs.get("origins", resolved.origin.contentHash);
    if (!blob) throw new Error("Origin payload is unavailable");
    assertCaptureLimit(blob.bytes.byteLength, resolved.source.executionLimits);
    const bundle = await compileCandidateBundle(
      skill.compiledSource,
      { bytes: blob.bytes, limits: resolved.source.executionLimits },
      resolved.source.executionLimits,
    );
    assertVerifiedCandidateBundle(bundle, skill.compiledSource);
    return {
      candidates: await candidatesFromBundle(
        bundle,
        resolved.source,
        resolved.origin,
        ownerUuid,
        operationUuid,
        skill.parser.version,
        this.baseUrl,
        this.blobs,
      ),
      ...(bundle.destination ? { destination: bundle.destination } : {}),
      kind: "origin",
      origin: resolved.origin,
      source: resolved.source,
      sourceStateDigest: resolved.sourceStateDigest,
      verify: bundle.verify,
    };
  }

  private async stageCredentialSource(
    resolved: ResolvedCredentialSource,
    ownerUuid: string,
    operationUuid: string,
    continuation?: ConnectedSourceContinuation,
  ): Promise<StagedSourceCapture> {
    const reservation = await this.reserveCredentialFetch(resolved, ownerUuid, operationUuid);
    const reservedSource = reservation.resolved;
    const fetchUuid = reservation.fetchUuid;

    let phase: "fetch" | "parse" | "verify" | "candidate" = "fetch";
    let providerRequestStarted = false;
    try {
      const endDateEpoch = Math.floor(Date.now() / 1_000);
      const prepared = await this.prepareConnectedFetch(
        reservedSource,
        continuation?.resume,
        endDateEpoch,
      );
      let secret = await this.credentialCrypto.open(
        reservedSource.credential.secret,
        credentialAssociatedData(
          reservedSource.credential.uuid,
          ownerUuid,
          reservedSource.credential.skillId,
        ),
      );
      secret = await this.refreshCredential(reservation, ownerUuid, secret, () => {
        providerRequestStarted = true;
      });
      providerRequestStarted = true;
      let bytes: Uint8Array;
      try {
        bytes = await withProviderRequestDeadline(
          (signal) => prepared.fetch.retrieve(secret, { signal }),
          sourceCaptureProviderTimeoutMilliseconds(reservedSource.source.executionLimits),
        );
      } catch (error) {
        if (
          error instanceof ConnectedSourceError &&
          error.skillId === reservedSource.skill.skillId
        ) {
          throw error;
        }
        throw new ConnectedSourceError(reservedSource.skill.skillId, {
          status: 422,
          code: "source_connection_failed",
          title: `${reservedSource.skill.displayName} request failed`,
          detail: "The connected source could not retrieve data from its provider",
        });
      }
      assertCaptureLimit(bytes.byteLength, reservedSource.source.executionLimits);
      // The credential is no longer in use once the exact provider response is in memory. Release
      // the dedicated pool connection before origin persistence so distinct concurrent
      // credentials cannot reserve the entire pool and then wait for an unreserved connection.
      // The already-durable fetch row still counts a provider request if later persistence fails.
      await reservation.release();
      const origin = await storeOwnedOriginArtifact(
        { db: this.db, blobs: this.blobs },
        {
          ownerUuid,
          bytes,
          mime: reservedSource.skill.capture.mime,
          label: reservedSource.skill.capture.label(fetchUuid),
        },
      );
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
      const bundle = await compileCandidateBundle(
        prepared.fetch.compiledSource,
        { bytes, limits: reservedSource.source.executionLimits },
        reservedSource.source.executionLimits,
      );

      phase = "verify";
      assertVerifiedCandidateBundle(bundle, prepared.fetch.compiledSource);

      phase = "candidate";
      if (prepared.fetch.actionEvidence) {
        assertDeclaredReviewAction(reservedSource.skill, prepared.fetch.actionEvidence.kind);
      }
      const candidates = await candidatesFromBundle(
        bundle,
        reservation.resolved.source,
        origin,
        ownerUuid,
        operationUuid,
        reservedSource.skill.parser.version,
        this.baseUrl,
        this.blobs,
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
        ...(prepared.fetch.actionEvidence ? { actionEvidence: prepared.fetch.actionEvidence } : {}),
        candidates,
        ...(bundle.destination ? { destination: bundle.destination } : {}),
        fetchUuid,
        kind: "credential",
        origin,
        source: reservation.resolved.source,
        sourceStateDigest: reservation.resolved.sourceStateDigest,
        verify: bundle.verify,
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
        // untouched reservation keeps the rolling limit tied to actual provider attempts.
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

  /** Refreshes OAuth token sets while the caller holds the credential's advisory fetch lease. */
  private async refreshCredential(
    reservation: CredentialFetchReservation,
    ownerUuid: string,
    secret: string,
    onProviderRequestStart: () => void,
  ): Promise<string> {
    const resolved = reservation.resolved;
    const connection = resolved.skill.connection;
    if (connection.mode !== "oauth2_pkce") return secret;
    const refresh = connection.refresh;
    if (!refresh) return secret;
    const preparedSeal = await this.credentialCrypto.prepareSeal(
      credentialAssociatedData(resolved.credential.uuid, ownerUuid, resolved.credential.skillId),
    );
    try {
      let refreshed: Awaited<ReturnType<NonNullable<typeof connection.refresh>>>;
      try {
        onProviderRequestStart();
        refreshed = await withProviderRequestDeadline((signal) => refresh(secret, { signal }));
      } catch (error) {
        throw new ConnectedSourceError(resolved.skill.skillId, {
          status: 422,
          code: "source_connection_failed",
          title: `${resolved.skill.displayName} connection needs attention`,
          detail:
            error instanceof CredentialConnectionError
              ? error.message
              : "The connected source could not refresh its authorization",
        });
      }
      if (!refreshed) return secret;
      const sealed = await preparedSeal.seal(refreshed.secret);
      const metadata = publicMetadataForStorage(refreshed.publicMetadata);
      const updated = await reservation.updateCredential({
        secret: sealed,
        ...(metadata === undefined ? {} : { publicMetadata: metadata }),
      });
      if (!updated) throw notFound("Source credential");
      return refreshed.secret;
    } finally {
      preparedSeal.destroy();
    }
  }

  /** Loads the exact committed capture and asks the owning skill to plan one bounded request. */
  private async prepareConnectedFetch(
    resolved: ResolvedCredentialSource,
    resume?: SourceJsonValue,
    endDateEpoch = Math.floor(Date.now() / 1_000),
  ): Promise<{ config: unknown; fetch: PreparedConnectedSourceFetch }> {
    const config = resolved.skill.parseConfig(resolved.source.config);
    let previousCapture: Uint8Array | undefined;
    if (resolved.baseline) {
      const previousBlob = await this.blobs.get("origins", resolved.baseline.origin.contentHash);
      if (!previousBlob) throw new Error("Previous connected capture is unavailable");
      previousCapture = previousBlob.bytes;
    }
    return {
      config,
      fetch: await resolved.skill.prepareFetch({
        config,
        endDateEpoch,
        limits: resolved.source.executionLimits,
        ...(previousCapture ? { previousCapture } : {}),
        ...(resume === undefined ? {} : { resume }),
      }),
    };
  }

  private async sourceActionError(
    requirement: ConnectedSourceActionRequired,
    resolved: ResolvedCredentialSource,
    vibe: DbVibe,
    pendingVibe = false,
  ): Promise<ConnectedSourceError> {
    if (requirement.skillId !== resolved.skill.skillId) {
      throw new Error("Connected-source action skill id does not match its registered skill");
    }
    assertDeclaredReviewAction(resolved.skill, requirement.kind);
    if (
      requirement.title.length === 0 ||
      requirement.title.length > 256 ||
      requirement.detail.length === 0 ||
      requirement.detail.length > 2_048
    ) {
      throw new Error("Connected-source action copy exceeds its public bounds");
    }
    const source = `source:${resolved.source.uuid}`;
    const continuationToken = await this.sealSourceContinuation(
      requirement,
      vibe.uuid,
      vibe.ownerUuid,
      source,
      resolved.sourceStateDigest,
    );
    const requiredAction: SourceJsonObject = {
      kind: "source_action_required",
      action: requirement.kind,
      title: requirement.title,
      detail: requirement.detail,
      source,
      continuation_token: continuationToken,
      ...(pendingVibe ? { destination: { kind: "pending_vibe", id: vibe.uuid } } : {}),
    };
    return new ConnectedSourceError(requirement.skillId, {
      status: 422,
      code: "source_action_required",
      title: requirement.title,
      detail: requirement.detail,
      extensions: { required_action: requiredAction },
      operationResult: {
        code: "source_action_required",
        required_action: requiredAction,
      },
    });
  }

  private async sealSourceContinuation(
    requirement: ConnectedSourceActionRequired,
    vibeUuid: string,
    ownerUuid: string,
    source: string,
    sourceStateDigest: string,
  ): Promise<string> {
    return this.sourceContinuations.seal({
      kind: requirement.kind,
      ownerUuid,
      resume: requirement.resume,
      source,
      sourceStateDigest,
      vibeUuid,
    });
  }

  private async openSourceContinuation(
    token: string,
    vibeUuid: string,
    ownerUuid: string,
    resolved: ResolvedSource,
  ): Promise<ConnectedSourceContinuation> {
    try {
      if (resolved.kind !== "credential") throw invalidContinuation();
      return await this.sourceContinuations.open(token, {
        ownerUuid,
        source: `source:${resolved.source.uuid}`,
        sourceStateDigest: resolved.sourceStateDigest,
        vibeUuid,
      });
    } catch {
      throw invalidContinuation();
    }
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
    const connection = await this.providerLeasePool.reserve();
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

    const updateCredential: CredentialFetchReservation["updateCredential"] = async (input) => {
      if (connectionReleased || !leaseHeld) {
        throw new Error("Credential fetch lease is not active");
      }
      const rows =
        input.publicMetadata === undefined
          ? await connection<Array<{ uuid: string }>>`
              update source_credentials
              set secret = ${input.secret}
              where uuid = ${expected.credential.uuid}
                and user_uuid = ${ownerUuid}
                and skill_id = ${expected.credential.skillId}
                and connector_version = ${expected.credential.connectorVersion}
                and revoked_at is null
              returning uuid
            `
          : await connection<Array<{ uuid: string }>>`
              update source_credentials
              set
                secret = ${input.secret},
                metadata = ${JSON.stringify(input.publicMetadata)}::jsonb
              where uuid = ${expected.credential.uuid}
                and user_uuid = ${ownerUuid}
                and skill_id = ${expected.credential.skillId}
                and connector_version = ${expected.credential.connectorVersion}
                and revoked_at is null
              returning uuid
            `;
      return Boolean(rows[0]);
    };

    try {
      await connection`begin`;
      let reserved: ResolvedCredentialSource;
      try {
        const [locked] = await connection<
          Array<{
            credential_connector_version: string;
            credential_skill_id: string;
            credential_secret: Uint8Array;
            credential_uuid: string;
            owner_uuid: string;
            source_config: unknown;
            source_connector_version: string;
            source_execution_limits: unknown;
            source_kind: string;
            source_parser: string;
            source_parser_version: string;
            source_skill_id: string;
            source_uuid: string;
          }>
        >`
          select
            credential.uuid as credential_uuid,
            credential.user_uuid as owner_uuid,
            credential.skill_id as credential_skill_id,
            credential.connector_version as credential_connector_version,
            credential.secret as credential_secret,
            source.uuid as source_uuid,
            source.kind as source_kind,
            source.skill_id as source_skill_id,
            source.connector_version as source_connector_version,
            source.parser as source_parser,
            source.parser_version as source_parser_version,
            source.execution_limits as source_execution_limits,
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
            connector_version: string;
            origin_content_hash: string;
            origin_uuid: string;
            parser_version: string;
          }>
        >`
          select
            source_fetch.uuid as fetch_uuid,
            source_fetch.connector_version,
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
          locked.credential_skill_id !== expected.credential.skillId ||
          locked.credential_connector_version !== expected.credential.connectorVersion ||
          locked.source_uuid !== expected.source.uuid ||
          locked.source_kind !== expected.source.kind ||
          locked.source_skill_id !== expected.source.skillId ||
          locked.source_connector_version !== expected.source.connectorVersion ||
          locked.source_parser !== expected.source.parser ||
          locked.source_parser_version !== expected.source.parserVersion ||
          canonicalJson(locked.source_execution_limits) !==
            canonicalJson(expected.source.executionLimits) ||
          canonicalJson(locked.source_config ?? {}) !==
            canonicalJson(expected.source.config ?? {}) ||
          Boolean(baseline) !== Boolean(expectedBaseline) ||
          (baseline !== undefined &&
            (baseline.fetch_uuid !== expectedBaseline?.fetch.uuid ||
              baseline.connector_version !== expectedBaseline.fetch.connectorVersion ||
              baseline.parser_version !== expectedBaseline.fetch.parserVersion ||
              baseline.origin_uuid !== expectedBaseline.origin.uuid ||
              baseline.origin_content_hash !== expectedBaseline.origin.contentHash))
        ) {
          throw new Error("The connected source changed before its fetch could start");
        }
        const candidate: ResolvedCredentialSource = {
          ...expected,
          credential: { ...expected.credential, secret: locked.credential_secret },
        };

        // Credential/source row locks are acquired before this session lock, matching the
        // revocation transaction's row-lock-then-advisory-lock order and avoiding deadlocks.
        const [lock] = await connection<[{ acquired: boolean }]>`
          select pg_try_advisory_lock(
            hashtextextended(${candidate.credential.uuid}::text, ${CREDENTIAL_FETCH_LOCK_SEED}::bigint)
          ) as acquired
        `;
        if (!lock?.acquired) {
          throw new ConnectedSourceError(candidate.skill.skillId, {
            status: 429,
            code: "rate_limited",
            title: `${candidate.skill.displayName} fetch already in progress`,
            detail: "Wait for the active credential fetch to finish before trying again",
          });
        }
        leaseHeld = true;

        const [recent] = await connection<Array<{ count: number }>>`
          select count(*)::int as count
          from ingestion_source_fetches
          where credential_uuid = ${candidate.credential.uuid}
            and created_at >= now() - make_interval(hours => ${candidate.skill.fetchPolicy.windowHours})
        `;
        assertCredentialFetchAllowance(candidate.skill, recent?.count ?? 0);

        await connection`
          insert into ingestion_source_fetches (
            uuid,
            source_uuid,
            owner_uuid,
            credential_uuid,
            operation_uuid,
            connector_version,
            parser_version,
            source_state_digest,
            execution_limits
          ) values (
            ${fetchUuid},
            ${candidate.source.uuid},
            ${ownerUuid},
            ${candidate.credential.uuid},
            ${operationUuid},
            ${candidate.source.connectorVersion},
            ${candidate.source.parserVersion},
            ${candidate.sourceStateDigest},
            ${JSON.stringify(candidate.source.executionLimits)}::jsonb
          )
        `;
        reserved = candidate;
        await connection`commit`;
      } catch (error) {
        await connection`rollback`;
        throw error;
      }
      return { fetchUuid, release, resolved: reserved, updateCredential };
    } catch (error) {
      await release();
      throw error;
    }
  }

  /**
   * Serializes public-remote retrieval per owner and skill, then records the attempt before
   * outbound traffic. The catalog supplies the rolling limit; the server supplies enforcement.
   */
  private async reservePublicRemoteFetch(
    expected: ResolvedRemoteSource,
    ownerUuid: string,
    operationUuid: string,
  ): Promise<PublicRemoteFetchReservation> {
    const connection = await this.providerLeasePool.reserve();
    const fetchUuid = uuidv7();
    let leaseHeld = false;
    let connectionReleased = false;
    const release = async (): Promise<void> => {
      if (connectionReleased) return;
      try {
        if (leaseHeld) {
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
      try {
        const [locked] = await connection<
          Array<{
            source_config: unknown;
            source_connector_version: string;
            source_execution_limits: unknown;
            source_kind: string;
            source_parser: string;
            source_parser_version: string;
            source_skill_id: string;
            source_uuid: string;
          }>
        >`
          select
            source.uuid as source_uuid,
            source.kind as source_kind,
            source.skill_id as source_skill_id,
            source.connector_version as source_connector_version,
            source.parser as source_parser,
            source.parser_version as source_parser_version,
            source.execution_limits as source_execution_limits,
            source.config as source_config
          from ingestion_sources as source
          where source.uuid = ${expected.source.uuid}
            and source.owner_uuid = ${ownerUuid}
            and source.kind = 'remote'
            and source.origin_uuid is null
            and source.credential_uuid is null
            and source.revoked_at is null
          for update of source
        `;
        if (!locked) throw notFound("Ingestion source");
        if (
          locked.source_uuid !== expected.source.uuid ||
          locked.source_kind !== expected.source.kind ||
          locked.source_skill_id !== expected.source.skillId ||
          locked.source_connector_version !== expected.source.connectorVersion ||
          locked.source_parser !== expected.source.parser ||
          locked.source_parser_version !== expected.source.parserVersion ||
          canonicalJson(locked.source_execution_limits) !==
            canonicalJson(expected.source.executionLimits) ||
          canonicalJson(locked.source_config ?? {}) !== canonicalJson(expected.source.config ?? {})
        ) {
          throw new Error("The public-remote source changed before its fetch could start");
        }

        const lockKey = `${ownerUuid}:${expected.skill.skillId}`;
        const [lock] = await connection<[{ acquired: boolean }]>`
          select pg_try_advisory_lock(
            hashtextextended(${lockKey}::text, ${PUBLIC_REMOTE_FETCH_LOCK_SEED}::bigint)
          ) as acquired
        `;
        if (!lock?.acquired) {
          throw new ConnectedSourceError(expected.skill.skillId, {
            status: 429,
            code: "rate_limited",
            title: `${expected.skill.displayName} fetch already in progress`,
            detail: "Wait for the active public-source fetch to finish before trying again",
          });
        }
        leaseHeld = true;

        const [recent] = await connection<Array<{ count: number }>>`
          select count(*)::int as count
          from ingestion_source_fetches as source_fetch
          join ingestion_sources as source on source.uuid = source_fetch.source_uuid
          where source_fetch.owner_uuid = ${ownerUuid}
            and source.kind = 'remote'
            and source.skill_id = ${expected.skill.skillId}
            and source_fetch.created_at >= now() - make_interval(hours => ${expected.skill.fetchPolicy.windowHours})
        `;
        assertPublicRemoteFetchAllowance(expected.skill, recent?.count ?? 0);

        await connection`
          insert into ingestion_source_fetches (
            uuid,
            source_uuid,
            owner_uuid,
            credential_uuid,
            operation_uuid,
            connector_version,
            parser_version,
            source_state_digest,
            execution_limits
          ) values (
            ${fetchUuid},
            ${expected.source.uuid},
            ${ownerUuid},
            null,
            ${operationUuid},
            ${expected.source.connectorVersion},
            ${expected.source.parserVersion},
            ${expected.sourceStateDigest},
            ${JSON.stringify(expected.source.executionLimits)}::jsonb
          )
        `;
        await connection`commit`;
      } catch (error) {
        await connection`rollback`;
        throw error;
      }
      return { fetchUuid, release, resolved: expected };
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
          if (capture.kind !== resolved.kind || !capture.fetchUuid) {
            throw new Error("The fetched source capture is malformed");
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
      createdBy: STORE_ACTOR,
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
        ...(element.alt !== undefined ? { alt: element.alt } : {}),
        rnetSchema: RNET_SCHEMA_VERSION,
        createdBy: STORE_ACTOR,
      });
      await transaction.insert(mediaObjectElements).values({
        mediaObjectUuid,
        mediaElementUuid,
        position,
        role: element.role,
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
      if (
        !source.skillId ||
        source.skillId !== credential.skillId ||
        source.connectorVersion !== credential.connectorVersion
      ) {
        throw new Error("Credential ingestion source has an inconsistent implementation identity");
      }
      const skill = this.credentialedSources.forSource(credential.skillId, source.parser);
      if (!skill) {
        throw new Problem(
          422,
          "parser_unsupported",
          "Source skill unsupported",
          credential.skillId,
        );
      }
      if (skill.parser.version !== source.parserVersion) {
        throw new Error("Pinned parser version is unavailable");
      }
      if (skill.manifest.connector_version !== credential.connectorVersion) {
        throw new Error("Pinned connector version is unavailable");
      }

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
        if (
          baselineFetch.connectorVersion !== source.connectorVersion ||
          baselineFetch.parserVersion !== source.parserVersion
        ) {
          throw new Error("Committed connected baseline uses an unavailable source version");
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
      return { kind: "credential", source, credential, skill, baseline, sourceStateDigest };
    }

    if (observedSource.kind === "remote") {
      const [source] = await database
        .select()
        .from(ingestionSources)
        .where(
          and(
            eq(ingestionSources.uuid, sourceUuid),
            eq(ingestionSources.ownerUuid, ownerUuid),
            eq(ingestionSources.kind, "remote"),
            isNull(ingestionSources.revokedAt),
          ),
        )
        .for(lock);
      if (
        !source ||
        source.originUuid ||
        source.credentialUuid ||
        !source.skillId ||
        !source.connectorVersion ||
        !source.parser ||
        !source.config
      ) {
        throw notFound("Ingestion source");
      }
      const skill = this.publicRemoteSources.forPinnedSource({
        skillId: source.skillId,
        connectorVersion: source.connectorVersion,
        parserName: source.parser,
        parserVersion: source.parserVersion,
      });
      if (!skill) {
        throw new Problem(
          422,
          "parser_unsupported",
          "Pinned source implementation unavailable",
          `${source.skillId} ${source.connectorVersion} ${source.parserVersion}`,
        );
      }
      const config = skill.parseConfig(source.config);
      return {
        kind: "remote",
        source,
        skill,
        sourceStateDigest: await publicRemoteSourceStateDigest(source, skill, config),
      };
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
    if (!source || !source.originUuid || source.credentialUuid || !source.skillId) {
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
    assertPinnedFileSkill(source, this.fileSources);
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
    resolved: ResolvedCredentialSource | ResolvedRemoteSource,
    originUuid: string,
    sourceStateDigest: string,
    fetchUuid?: string,
  ): Promise<DbIngestionSourceFetch> {
    const conditions = [
      eq(ingestionSourceFetches.operationUuid, operationUuid),
      eq(ingestionSourceFetches.sourceUuid, resolved.source.uuid),
      eq(ingestionSourceFetches.originUuid, originUuid),
      eq(ingestionSourceFetches.connectorVersion, resolved.source.connectorVersion),
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
    if (!fetch) throw invalidReview("The fetched capture is stale or unavailable");
    if (canonicalJson(fetch.executionLimits) !== canonicalJson(resolved.source.executionLimits)) {
      throw invalidReview("The fetched capture limits no longer match its source");
    }
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
    if (!committed) throw invalidReview("The fetched capture was already consumed");
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

function operationContinuationAction(
  request: DbOperation["request"],
): ConnectedSourceActionKind | undefined {
  const action = request.continuation_action;
  if (action === undefined) return undefined;
  if (action === "review_import") return action;
  throw invalidReview("The preview continuation action is malformed");
}

function pendingDestinationUuid(request: DbOperation["request"]): string | undefined {
  const destination = request.pending_destination;
  if (!destination || typeof destination !== "object" || Array.isArray(destination)) {
    return undefined;
  }
  const uuid = (destination as Record<string, unknown>).vibe_uuid;
  return typeof uuid === "string" ? uuid : undefined;
}

function delegatedSourceActionError(skillId: string): ConnectedSourceError {
  const title = "Connected source requires owner review";
  const detail = "The connected source owner must review an import before pulling again.";
  return new ConnectedSourceError(skillId, {
    status: 422,
    code: "source_action_required",
    title,
    detail,
    extensions: { action: "review_import", owner_action_required: true },
  });
}

function invalidContinuation(): Problem {
  return new Problem(
    422,
    "schema_violation",
    "Continuation invalid",
    "The source continuation token is invalid or expired",
  );
}

const ORIGIN_URI_PATTERN = new RegExp(rnetUriPattern("origin"));

function originUuidOf(origin: string): string {
  if (!ORIGIN_URI_PATTERN.test(origin)) throw invalidReview("The staged origin is malformed");
  return origin.slice("rnet://origin/".length);
}

function assertPinnedFileSkill(
  source: DbIngestionSource,
  catalog: FileSourceCatalog,
): FileSourceSkill {
  const skill = source.skillId ? catalog.forSkillId(source.skillId) : undefined;
  if (!skill) {
    throw new Problem(
      422,
      "parser_unsupported",
      "Source skill unsupported",
      source.skillId ?? "missing skill id",
    );
  }
  if (skill.parser.name !== source.parser || skill.parser.version !== source.parserVersion) {
    throw new Problem(422, "parser_unsupported", "Pinned parser unavailable", source.parserVersion);
  }
  if (skill.manifest.connector_version !== source.connectorVersion) {
    throw new Problem(
      422,
      "parser_unsupported",
      "Pinned connector unavailable",
      source.connectorVersion,
    );
  }
  return skill;
}

async function originSourceStateDigest(
  source: DbIngestionSource,
  origin: DbOriginArtifact,
): Promise<string> {
  return digest({
    source: source.uuid,
    kind: source.kind,
    skill_id: source.skillId,
    connector_version: source.connectorVersion,
    parser: source.parser,
    parser_version: source.parserVersion,
    limits: source.executionLimits,
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
    connector_version: source.connectorVersion,
    parser: source.parser,
    parser_version: source.parserVersion,
    limits: source.executionLimits,
    config: source.config ?? {},
    credential: credential.uuid,
    skill_id: source.skillId,
    baseline: baseline
      ? {
          fetch: baseline.fetch.uuid,
          connector_version: baseline.fetch.connectorVersion,
          parser_version: baseline.fetch.parserVersion,
          origin: baseline.origin.uuid,
          content_hash: baseline.origin.contentHash,
        }
      : null,
  });
}

async function publicRemoteSourceStateDigest(
  source: DbIngestionSource,
  skill: PublicRemoteSourceSkill,
  config: unknown,
): Promise<string> {
  const skillState = skill.stateDigest(config);
  assertJsonSerializable(skillState, "Public-source state digest");
  return digest({
    source: source.uuid,
    kind: source.kind,
    skill_id: source.skillId,
    connector_version: source.connectorVersion,
    parser: source.parser,
    parser_version: source.parserVersion,
    limits: source.executionLimits,
    config: source.config ?? {},
    skill_state: skillState,
  });
}

function assertCredentialFetchAllowance(
  skill: CredentialedSourceSkill,
  recentAttemptCount: number,
): void {
  if (!Number.isSafeInteger(recentAttemptCount) || recentAttemptCount < 0) {
    throw new Error("Connected-source fetch attempt count is invalid");
  }
  if (recentAttemptCount >= skill.fetchPolicy.attempts) {
    throw new ConnectedSourceError(skill.skillId, {
      status: 429,
      code: "rate_limited",
      title: `${skill.displayName} fetch limit reached`,
      detail: `This credential has already attempted ${skill.fetchPolicy.attempts} fetches in the last ${skill.fetchPolicy.windowHours} hours`,
    });
  }
}

function assertPublicRemoteFetchAllowance(
  skill: PublicRemoteSourceSkill,
  recentAttemptCount: number,
): void {
  if (!Number.isSafeInteger(recentAttemptCount) || recentAttemptCount < 0) {
    throw new Error("Public-source fetch attempt count is invalid");
  }
  if (recentAttemptCount >= skill.fetchPolicy.attempts) {
    throw new ConnectedSourceError(skill.skillId, {
      status: 429,
      code: "rate_limited",
      title: `${skill.displayName} fetch limit reached`,
      detail: `This owner has already attempted ${skill.fetchPolicy.attempts} ${skill.displayName} fetches in the last ${skill.fetchPolicy.windowHours} hours`,
    });
  }
}

function assertDeclaredReviewAction(
  skill: CredentialedSourceSkill,
  action: ConnectedSourceActionKind,
): void {
  if (!skill.manifest.review_actions.includes(action)) {
    throw new Error(`Connected-source ${skill.skillId} emitted undeclared review action ${action}`);
  }
}

function failedChecks(report: SourceVerifyReport): string {
  const names = report.checks.filter(({ ok }) => !ok).map(({ name }) => name);
  return names.length ? names.join(", ") : "unknown_check";
}

async function compileCandidateBundle<Input>(
  capability: CandidateBundleCapability<Input>,
  input: Input,
  limits: SourceExecutionLimits,
): Promise<CandidateBundle> {
  if (capability.kind !== CANDIDATE_BUNDLE_CAPABILITY) {
    throw new Error(`Unsupported compiled-source capability: ${String(capability.kind)}`);
  }
  const bundle = await capability.compile(input);
  if (!bundle || bundle.kind !== CANDIDATE_BUNDLE_CAPABILITY || !Array.isArray(bundle.candidates)) {
    throw new Error("Compiled source returned a malformed candidate bundle");
  }
  assertSourceVerifyReport(bundle.verify);
  if (
    bundle.destination !== undefined &&
    (typeof bundle.destination.title !== "string" ||
      !bundle.destination.title.trim() ||
      bundle.destination.title.length > 256)
  ) {
    throw new Error("Compiled source returned an invalid destination suggestion");
  }
  assertCandidateBundleLimits(bundle, limits);
  return bundle;
}

function assertVerifiedCandidateBundle<Input>(
  bundle: CandidateBundle,
  capability: CandidateBundleCapability<Input>,
): void {
  if (bundle.verify.ok) return;
  const sourceError = capability.verificationError?.(bundle.verify);
  if (sourceError) throw sourceError;
  throw new Error(`VERIFY rejected candidate bundle: ${failedChecks(bundle.verify)}`);
}

async function candidatesFromBundle(
  bundle: CandidateBundle,
  source: DbIngestionSource,
  origin: DbOriginArtifact,
  ownerUuid: string,
  operationUuid: string,
  parserVersion: string,
  baseUrl: string,
  blobs: BlobStore,
): Promise<StagedCandidate[]> {
  if (!Array.isArray(bundle.candidates)) {
    throw new Error("Compiled source returned no candidate list");
  }
  const candidates: StagedCandidate[] = [];
  const identities = new Set<string>();
  for (const draft of bundle.candidates) {
    assertSourceCandidateDraft(draft);
    const objectUri = `rnet://object/${uuidv7()}`;
    const elements: StagedElement[] = [];
    for (const element of draft.elements) {
      if (
        element.byteSize !== element.bytes.byteLength ||
        element.byteSize <= 0 ||
        !/^sha256:[a-f0-9]{64}$/.test(element.contentHash) ||
        (await contentHash(element.bytes)) !== element.contentHash
      ) {
        throw new Error("Compiled source produced inconsistent element metadata");
      }
      await blobs.put("elements", element.contentHash, element.bytes, element.mime);
      const elementUuid = uuidv7();
      elements.push({
        uri: `rnet://element/${elementUuid}`,
        object_uri: objectUri,
        role: element.role,
        ...(element.alt !== undefined ? { alt: element.alt } : {}),
        kind: element.kind,
        mime: element.mime,
        byte_size: element.byteSize,
        content_hash: element.contentHash,
        preview_url: `${baseUrl}/rnet/v0/operations/${operationUuid}/elements/${elementUuid}/bytes`,
      });
    }
    const candidate: MediaObject = {
      rnet_schema: RNET_SCHEMA_VERSION,
      uri: objectUri,
      owner: `rnet://id/${ownerUuid}`,
      type: draft.type,
      elements: elements.map(({ uri, role }) => ({ uri, role })),
      keys: { ...draft.keys },
      source: {
        ingest: {
          method: "parser",
          reproducible: true,
          skill: parserVersion,
        },
        origins: [`rnet://origin/${origin.uuid}`],
        ...(draft.retrievedAt ? { retrieved_at: draft.retrievedAt } : {}),
        properties: { ...draft.sourceProperties },
      },
    };
    const validation = validateMediaObject(candidate);
    if (!validation.ok) {
      throw new Error(
        `Compiled source produced a nonconformant candidate: ${validation.issues
          .map((issue) => `${issue.instancePath} ${issue.message}`)
          .join(", ")}`,
      );
    }
    const identity = await digest(draft.semanticIdentity);
    if (identities.has(identity)) {
      throw new Error("Compiled source repeated a candidate identity");
    }
    identities.add(identity);
    candidates.push({
      candidate,
      candidate_digest: await candidateSemanticDigest(
        candidate,
        elements,
        () => draft.semanticSourceProperties ?? draft.sourceProperties,
      ),
      elements,
      identity,
      origin_uuid: origin.uuid,
      semantic_identity: draft.semanticIdentity,
      semantic_source_properties: draft.semanticSourceProperties ?? draft.sourceProperties,
      source_uuid: source.uuid,
    });
  }
  return candidates;
}

function assertSourceCandidateDraft(value: SourceCandidateDraft): void {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.type !== "string" ||
    !value.type ||
    !value.keys ||
    typeof value.keys !== "object" ||
    Array.isArray(value.keys) ||
    Object.values(value.keys).some((entry) => typeof entry !== "string" || entry.length > 512) ||
    !value.sourceProperties ||
    typeof value.sourceProperties !== "object" ||
    Array.isArray(value.sourceProperties) ||
    !Array.isArray(value.elements) ||
    value.semanticIdentity === undefined
  ) {
    throw new Error("Compiled source produced a malformed candidate draft");
  }
  assertJsonSerializable(value.keys, "Candidate keys");
  assertJsonSerializable(value.sourceProperties, "Candidate properties");
  assertJsonSerializable(value.semanticIdentity, "Candidate semantic identity");
  if (value.semanticSourceProperties !== undefined) {
    assertJsonSerializable(value.semanticSourceProperties, "Candidate semantic properties");
  }
}

function assertSourceVerifyReport(report: SourceVerifyReport): void {
  if (
    !report ||
    typeof report !== "object" ||
    typeof report.ok !== "boolean" ||
    !Array.isArray(report.checks) ||
    report.checks.some(
      (check) =>
        !check ||
        typeof check !== "object" ||
        typeof check.name !== "string" ||
        !check.name ||
        typeof check.ok !== "boolean" ||
        typeof check.detail !== "string",
    )
  ) {
    throw new Error("Compiled source produced a malformed VERIFY report");
  }
  assertJsonSerializable(report, "Source VERIFY report");
}

function assertJsonSerializable(value: unknown, label: string): void {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must contain JSON values`);
  }
  if (encoded === undefined) throw new Error(`${label} must contain JSON values`);
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  return contentHash(bytes);
}

/**
 * Identifies canonical source values independently of the candidate URI and capture event.
 * Element identity is content-based, so a provider can later mint fresh staged element URIs
 * without making an unchanged candidate appear changed. `alt` describes the element payload
 * (it lands on the MediaElement record, not the object's reference), so it participates here as
 * an element attribute alongside the payload facts.
 */
export function candidateSemanticDigest(
  candidate: MediaObject,
  elements: readonly StagedElement[] = [],
  identitySourceProperties: IdentitySourceProperties = identityProperties,
): Promise<string> {
  const { uri: _uri, source, elements: _elementUris, ...content } = candidate;
  const { origins: _origins, retrieved_at: _retrievedAt, properties, ...sourceIdentity } = source;
  const semanticProperties = identitySourceProperties(properties);
  const semanticSource = { ...sourceIdentity, properties: semanticProperties };
  const semanticElements = elements.map(({ role, alt, kind, mime, byte_size, content_hash }) => ({
    role,
    ...(alt !== undefined ? { alt } : {}),
    kind,
    mime,
    byte_size,
    content_hash,
  }));
  return digest({ ...content, elements: semanticElements, source: semanticSource });
}

type IdentitySourceProperties = (properties: Record<string, unknown>) => Record<string, unknown>;

function identityProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return properties;
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
    !Array.isArray(result.candidate_metadata) ||
    !Array.isArray(result.elements) ||
    !result.verify ||
    typeof result.source_digest !== "string" ||
    typeof result.staged_origin !== "string" ||
    typeof result.review_digest !== "string"
  ) {
    throw invalidReview("The staged result is malformed");
  }
  if (
    result.candidate_metadata.length !== result.candidates.length ||
    result.candidate_metadata.some((metadata) => !validStagedCandidateMetadata(metadata)) ||
    new Set(result.candidate_metadata.map(({ object_uri }) => object_uri)).size !==
      result.candidate_metadata.length
  ) {
    throw invalidReview("The staged candidate metadata is malformed");
  }
  if (
    result.action_evidence !== undefined &&
    !validConnectedSourceActionEvidence(result.action_evidence)
  ) {
    throw invalidReview("The staged action evidence is malformed");
  }
  if (
    result.destination !== undefined &&
    (!result.destination ||
      typeof result.destination !== "object" ||
      typeof result.destination.title !== "string" ||
      !result.destination.title.trim() ||
      result.destination.title.length > 256)
  ) {
    throw invalidReview("The staged destination suggestion is malformed");
  }
  return result as ImportPreviewResult;
}

function validStagedCandidateMetadata(value: unknown): value is StagedCandidateMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as Partial<StagedCandidateMetadata>;
  if (
    typeof metadata.object_uri !== "string" ||
    metadata.semantic_identity === undefined ||
    !metadata.semantic_source_properties ||
    typeof metadata.semantic_source_properties !== "object" ||
    Array.isArray(metadata.semantic_source_properties)
  ) {
    return false;
  }
  try {
    assertJsonSerializable(metadata.semantic_identity, "Candidate semantic identity");
    assertJsonSerializable(metadata.semantic_source_properties, "Candidate semantic properties");
    return true;
  } catch {
    return false;
  }
}

function validConnectedSourceActionEvidence(
  value: unknown,
): value is ConnectedSourceActionEvidence {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 1 &&
    (value as Record<string, unknown>).kind === "review_import"
  );
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
    candidate.elements.some((reference, index) => {
      const element = elements[index];
      return !element || reference.uri !== element.uri || reference.role !== element.role;
    }) ||
    new Set(candidate.elements.map(({ uri }) => uri)).size !== candidate.elements.length
  ) {
    throw invalidReview("Candidate element order mismatch");
  }
  for (const element of elements) {
    if (
      element.object_uri !== candidate.uri ||
      !MediaObjectElementRoleEnum.includes(element.role) ||
      (element.alt !== undefined && typeof element.alt !== "string") ||
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
