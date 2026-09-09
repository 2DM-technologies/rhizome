import {
  type CreateIngestionSourceRequest,
  type IngestionSourceDocument,
} from "@rhizome/store-contract";
import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { CredentialedSourceCatalog } from "../../../ingest/connected-sources/types.ts";
import type { FileSourceCatalog } from "../../../ingest/file-sources/types.ts";
import type { PublicRemoteSourceCatalog } from "../../../ingest/public-sources/types.ts";
import { assertCaptureLimit } from "../../../ingest/source-skills/execution-limits.ts";
import type { Database } from "../db/index.ts";
import {
  ingestionSources,
  type DbIngestionSource,
  type NewDbIngestionSource,
} from "../db/models/ingestion-source.ts";
import { originArtifacts } from "../db/models/origin-artifact.ts";
import type { JsonObject } from "../db/models/shared.ts";
import { sourceCredentials } from "../db/models/source-credential.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";

export class IngestionSourcesService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];
  private readonly credentialedSources: CredentialedSourceCatalog;
  private readonly fileSources: FileSourceCatalog;
  private readonly publicRemoteSources: PublicRemoteSourceCatalog;

  constructor(
    context: ServiceContext & {
      credentialedSources: CredentialedSourceCatalog;
      fileSources: FileSourceCatalog;
      publicRemoteSources: PublicRemoteSourceCatalog;
    },
  ) {
    this.db = context.db;
    this.actor = context.actor;
    this.credentialedSources = context.credentialedSources;
    this.fileSources = context.fileSources;
    this.publicRemoteSources = context.publicRemoteSources;
  }

  async create(input: CreateIngestionSourceRequest): Promise<DbIngestionSource> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    if ("credential" in input) return this.createCredentialSource(input);
    if (!("origin" in input)) return this.createPublicRemoteSource(input);

    const skill = this.fileSources.forSkillId(input.skill_id);
    if (!skill) {
      throw new Problem(422, "parser_unsupported", "Source skill unsupported", input.skill_id);
    }
    const originUuid = uriId(input.origin);
    const origin = await this.db.query.originArtifacts.findFirst({
      where: and(
        eq(originArtifacts.uuid, originUuid),
        eq(originArtifacts.ownerUuid, this.actor.uuid),
        isNull(originArtifacts.tombstonedAt),
      ),
    });
    if (!origin) throw notFound("Origin");
    try {
      assertCaptureLimit(origin.byteSize, skill.manifest.limits);
    } catch (error) {
      throw new Problem(
        422,
        "payload_too_large",
        "Source capture exceeds its limit",
        error instanceof Error ? error.message : "The source capture is too large",
      );
    }

    const candidate: NewDbIngestionSource = {
      uuid: uuidv7(),
      ownerUuid: this.actor.uuid,
      kind: "origin",
      skillId: skill.manifest.skill_id,
      connectorVersion: skill.manifest.connector_version,
      parser: skill.parser.name,
      parserVersion: skill.parser.version,
      executionLimits: skill.manifest.limits,
      originUuid,
    };
    const [source] = await this.db.insert(ingestionSources).values(candidate).returning();
    if (!source) throw new Error("Ingestion source insert did not return a row");
    return source;
  }

  private async createPublicRemoteSource(
    input: Extract<CreateIngestionSourceRequest, { skill_id: string; config: object }>,
  ): Promise<DbIngestionSource> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const skill = this.publicRemoteSources.currentForSkillId(input.skill_id);
    if (!skill) {
      throw new Problem(422, "parser_unsupported", "Source skill unsupported", input.skill_id);
    }
    let config: JsonObject;
    try {
      config = storedConfig(skill.normalizeConfig(input.config));
      skill.parseConfig(config);
    } catch (error) {
      throw new Problem(
        422,
        "schema_violation",
        "Source configuration invalid",
        error instanceof Error
          ? error.message
          : `${skill.displayName} source configuration is invalid`,
      );
    }
    const candidate: NewDbIngestionSource = {
      uuid: uuidv7(),
      ownerUuid: this.actor.uuid,
      kind: "remote",
      skillId: skill.manifest.skill_id,
      connectorVersion: skill.manifest.connector_version,
      parser: skill.parser.name,
      parserVersion: skill.parser.version,
      executionLimits: skill.manifest.limits,
      config,
    };
    const [source] = await this.db.insert(ingestionSources).values(candidate).returning();
    if (!source) throw new Error("Ingestion source insert did not return a row");
    return source;
  }

  private async createCredentialSource(
    input: Extract<CreateIngestionSourceRequest, { credential: string }>,
  ): Promise<DbIngestionSource> {
    if (this.actor.kind !== "user") throw grantMissing("owner");

    const ownerUuid = this.actor.uuid;
    const credentialUuid = input.credential.slice("credential:".length);
    return this.db.transaction(async (transaction) => {
      const [credential] = await transaction
        .select()
        .from(sourceCredentials)
        .where(
          and(
            eq(sourceCredentials.uuid, credentialUuid),
            eq(sourceCredentials.userUuid, ownerUuid),
            isNull(sourceCredentials.revokedAt),
          ),
        )
        .for("update");
      if (!credential) throw notFound("Source credential");
      const skill = this.credentialedSources.forSkillId(credential.skillId);
      if (!skill) {
        throw new Problem(
          422,
          "parser_unsupported",
          "Source skill unsupported",
          credential.skillId,
        );
      }
      if (skill.manifest.connector_version !== credential.connectorVersion) {
        throw new Problem(
          422,
          "parser_unsupported",
          "Pinned connector unavailable",
          credential.connectorVersion,
        );
      }
      let config: JsonObject;
      try {
        config = storedConfig(skill.parseConfig(input.config ?? {}));
      } catch (error) {
        throw new Problem(
          422,
          "schema_violation",
          "Source configuration invalid",
          error instanceof Error
            ? error.message
            : `${skill.displayName} source configuration is invalid`,
        );
      }

      const candidate: NewDbIngestionSource = {
        uuid: uuidv7(),
        ownerUuid,
        kind: "credential",
        skillId: skill.manifest.skill_id,
        connectorVersion: credential.connectorVersion,
        parser: skill.parser.name,
        parserVersion: skill.parser.version,
        executionLimits: skill.manifest.limits,
        credentialUuid,
        config,
      };
      const [source] = await transaction.insert(ingestionSources).values(candidate).returning();
      if (!source) throw new Error("Ingestion source insert did not return a row");
      return source;
    });
  }

  async getActiveOwned(sourceUuid: string): Promise<DbIngestionSource> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const source = await this.db.query.ingestionSources.findFirst({
      where: and(
        eq(ingestionSources.uuid, sourceUuid),
        eq(ingestionSources.ownerUuid, this.actor.uuid),
        isNull(ingestionSources.revokedAt),
      ),
    });
    if (!source) throw notFound("Ingestion source");
    return source;
  }
}

export function serializeIngestionSource(source: DbIngestionSource): IngestionSourceDocument {
  if (source.kind === "remote") {
    if (
      source.originUuid ||
      source.credentialUuid ||
      !source.skillId ||
      !source.connectorVersion ||
      !source.parser ||
      !source.config
    ) {
      throw new Error("Public-remote ingestion source is internally inconsistent");
    }
    return {
      source: `source:${source.uuid}`,
      kind: "remote",
      skill_id: source.skillId,
      connector_version: source.connectorVersion,
      parser: source.parser,
      parser_version: source.parserVersion,
      limits: source.executionLimits,
      config: source.config,
      created_at: source.createdAt.toISOString(),
    };
  }
  if (source.kind === "credential") {
    if (
      !source.credentialUuid ||
      source.originUuid ||
      !source.skillId ||
      !source.connectorVersion ||
      !source.parser
    ) {
      throw new Error("Credential ingestion source is internally inconsistent");
    }
    return {
      source: `source:${source.uuid}`,
      kind: "credential",
      skill_id: source.skillId,
      connector_version: source.connectorVersion,
      parser: source.parser,
      parser_version: source.parserVersion,
      limits: source.executionLimits,
      config: source.config ?? {},
      created_at: source.createdAt.toISOString(),
    };
  }
  if (
    source.kind !== "origin" ||
    !source.originUuid ||
    source.credentialUuid ||
    !source.skillId ||
    !source.connectorVersion ||
    !source.parser
  ) {
    throw new Error("Origin ingestion source is internally inconsistent");
  }
  return {
    source: `source:${source.uuid}`,
    kind: "origin",
    skill_id: source.skillId,
    connector_version: source.connectorVersion,
    parser: source.parser,
    parser_version: source.parserVersion,
    limits: source.executionLimits,
    origin: `rnet://origin/${source.originUuid}`,
    created_at: source.createdAt.toISOString(),
  };
}

function storedConfig(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Connected source configuration must be an object");
  }
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error("Connected source configuration must contain JSON values");
  }
  if (!encoded) throw new Error("Connected source configuration must contain JSON values");
  const decoded: unknown = JSON.parse(encoded);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Connected source configuration must be an object");
  }
  return decoded as JsonObject;
}
