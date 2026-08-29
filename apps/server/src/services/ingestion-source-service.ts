import type {
  ArenaSourceConfig,
  CreateArenaIngestionSourceRequest,
  CreateIngestionSourceRequest,
  IngestionSourceDocument,
  SimpleFinSourceConfig,
} from "@rhizome/store-contract";
import {
  ARENA_CHANNEL_SLUG_MAX_LENGTH,
  ARENA_CHANNEL_SLUG_PATTERN,
  ARENA_PARSER_NAME,
  ARENA_PROVIDER,
  SIMPLEFIN_PARSER_NAME,
  SIMPLEFIN_PROVIDER,
} from "@rhizome/store-contract";
import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { parserFor } from "../../../ingest/src/registry.ts";
import type { Database } from "../db/index.ts";
import {
  ingestionSources,
  type DbIngestionSource,
  type NewDbIngestionSource,
} from "../db/models/ingestion-source.ts";
import { originArtifacts } from "../db/models/origin-artifact.ts";
import { sourceCredentials } from "../db/models/source-credential.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";

const arenaChannelSlugExpression = new RegExp(ARENA_CHANNEL_SLUG_PATTERN);
const arenaPublicHosts = new Set(["are.na", "www.are.na"]);

/**
 * Convert the only accepted caller-controlled Are.na locator forms into the
 * opaque slug used to construct provider API requests. No supplied hostname,
 * path prefix, query, or fragment is retained.
 */
export function normalizeArenaChannelSlug(channelUrl: string): string {
  const input = channelUrl.trim();
  if (arenaChannelSlugExpression.test(input) && input.length <= ARENA_CHANNEL_SLUG_MAX_LENGTH) {
    return input;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalidArenaChannel();
  }
  if (
    url.protocol !== "https:" ||
    !arenaPublicHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw invalidArenaChannel();
  }

  const path = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  const encodedSegments = path.split("/");
  if (encodedSegments.length !== 3 || encodedSegments[0] !== "") throw invalidArenaChannel();

  let owner: string;
  let slug: string;
  try {
    owner = decodeURIComponent(encodedSegments[1] ?? "");
    slug = decodeURIComponent(encodedSegments[2] ?? "");
  } catch {
    throw invalidArenaChannel();
  }
  if (
    !arenaChannelSlugExpression.test(owner) ||
    !arenaChannelSlugExpression.test(slug) ||
    owner.length > ARENA_CHANNEL_SLUG_MAX_LENGTH ||
    slug.length > ARENA_CHANNEL_SLUG_MAX_LENGTH
  ) {
    throw invalidArenaChannel();
  }
  return slug;
}

function invalidArenaChannel(): Problem {
  return new Problem(
    422,
    "schema_violation",
    "Invalid Are.na channel",
    "Use a public https://www.are.na/{owner}/{channel} URL or a channel slug",
  );
}

export class IngestionSourcesService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];

  constructor(context: ServiceContext) {
    this.db = context.db;
    this.actor = context.actor;
  }

  async create(input: CreateIngestionSourceRequest): Promise<DbIngestionSource> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    if ("provider" in input) return this.createArena(input);
    if ("credential" in input) return this.createSimpleFin(input);

    const parser = parserFor(input.parser);
    if (!parser) {
      throw new Problem(422, "parser_unsupported", "Parser unsupported", input.parser);
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
    const candidate: NewDbIngestionSource = {
      uuid: uuidv7(),
      ownerUuid: this.actor.uuid,
      kind: "origin",
      parser: parser.name,
      parserVersion: parser.version,
      originUuid,
    };
    const [source] = await this.db.insert(ingestionSources).values(candidate).returning();
    if (!source) throw new Error("Ingestion source insert did not return a row");
    return source;
  }

  private async createArena(input: CreateArenaIngestionSourceRequest): Promise<DbIngestionSource> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    if (input.provider !== ARENA_PROVIDER) {
      throw new Problem(422, "parser_unsupported", "Source provider unsupported", input.provider);
    }
    const parser = parserFor(ARENA_PARSER_NAME);
    if (!parser) {
      throw new Problem(422, "parser_unsupported", "Parser unsupported", ARENA_PARSER_NAME);
    }
    const channelSlug = normalizeArenaChannelSlug(input.channel_url);
    const candidate: NewDbIngestionSource = {
      uuid: uuidv7(),
      ownerUuid: this.actor.uuid,
      kind: "remote",
      provider: ARENA_PROVIDER,
      parser: parser.name,
      parserVersion: parser.version,
      config: { channel_slug: channelSlug },
    };
    const [source] = await this.db.insert(ingestionSources).values(candidate).returning();
    if (!source) throw new Error("Ingestion source insert did not return a row");
    return source;
  }

  private async createSimpleFin(
    input: Extract<CreateIngestionSourceRequest, { credential: string }>,
  ): Promise<DbIngestionSource> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const parser = parserFor(SIMPLEFIN_PARSER_NAME);
    if (!parser) {
      throw new Problem(422, "parser_unsupported", "Parser unsupported", SIMPLEFIN_PARSER_NAME);
    }
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
      if (credential.provider !== SIMPLEFIN_PROVIDER) {
        throw new Problem(
          422,
          "parser_unsupported",
          "Source provider unsupported",
          credential.provider,
        );
      }

      const candidate: NewDbIngestionSource = {
        uuid: uuidv7(),
        ownerUuid,
        kind: "credential",
        parser: parser.name,
        parserVersion: parser.version,
        credentialUuid,
        config: input.config ?? {},
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
    const config = arenaConfig(source.config);
    if (
      source.originUuid ||
      source.credentialUuid ||
      source.provider !== ARENA_PROVIDER ||
      source.parser !== ARENA_PARSER_NAME ||
      !config
    ) {
      throw new Error("Remote ingestion source is internally inconsistent");
    }
    return {
      source: `source:${source.uuid}`,
      kind: "remote",
      provider: ARENA_PROVIDER,
      parser: ARENA_PARSER_NAME,
      parser_version: source.parserVersion,
      config,
      created_at: source.createdAt.toISOString(),
    };
  }
  if (source.kind === "credential") {
    if (
      !source.credentialUuid ||
      source.originUuid ||
      source.provider ||
      source.parser !== SIMPLEFIN_PARSER_NAME
    ) {
      throw new Error("Credential ingestion source is internally inconsistent");
    }
    return {
      source: `source:${source.uuid}`,
      kind: "credential",
      parser: SIMPLEFIN_PARSER_NAME,
      parser_version: source.parserVersion,
      config: (source.config ?? {}) as SimpleFinSourceConfig,
      created_at: source.createdAt.toISOString(),
    };
  }
  if (source.kind !== "origin" || !source.originUuid || source.credentialUuid || source.provider) {
    throw new Error("Origin ingestion source is internally inconsistent");
  }
  return {
    source: `source:${source.uuid}`,
    kind: "origin",
    parser: source.parser as "csv" | "ofx",
    parser_version: source.parserVersion,
    origin: `rnet://origin/${source.originUuid}`,
    created_at: source.createdAt.toISOString(),
  };
}

function arenaConfig(config: DbIngestionSource["config"]): ArenaSourceConfig | undefined {
  if (!config || Object.keys(config).length !== 1) return undefined;
  const channelSlug = config.channel_slug;
  if (
    typeof channelSlug !== "string" ||
    channelSlug.length > ARENA_CHANNEL_SLUG_MAX_LENGTH ||
    !arenaChannelSlugExpression.test(channelSlug)
  ) {
    return undefined;
  }
  return { channel_slug: channelSlug };
}
