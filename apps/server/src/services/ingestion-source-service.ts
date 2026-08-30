import type {
  CreateIngestionSourceRequest,
  IngestionSourceDocument,
} from "@rhizome/store-contract";
import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { FILE_PARSER_NAMES, parserFor } from "../../../ingest/src/registry.ts";
import type { Database } from "../db/index.ts";
import {
  ingestionSources,
  type DbIngestionSource,
  type NewDbIngestionSource,
} from "../db/models/ingestion-source.ts";
import { originArtifacts } from "../db/models/origin-artifact.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";

const fileParserNames = new Set(["csv", "ofx"]);

export class IngestionSourcesService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];

  constructor(context: ServiceContext) {
    this.db = context.db;
    this.actor = context.actor;
  }

  async create(input: CreateIngestionSourceRequest): Promise<DbIngestionSource> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    if (!("origin" in input)) {
      throw new Problem(
        422,
        "parser_unsupported",
        "Source kind unsupported",
        "This store supports pinned file sources",
      );
    }

    if (!FILE_PARSER_NAMES.includes(input.parser)) {
      throw new Problem(422, "parser_unsupported", "Parser unsupported", input.parser);
    }
    const parser = fileParserNames.has(input.parser) ? parserFor(input.parser) : undefined;
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
  if (source.kind !== "origin" || !source.originUuid || !fileParserNames.has(source.parser)) {
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
