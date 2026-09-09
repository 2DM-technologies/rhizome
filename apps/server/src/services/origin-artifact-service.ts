import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { contentHash } from "../blobs/content.ts";
import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import {
  originArtifacts,
  type DbOriginArtifact,
  type NewDbOriginArtifact,
} from "../db/models/origin-artifact.ts";
import { grantMissing, notFound } from "../errors.ts";
import { RNET_SCHEMA_VERSION } from "../rnet.ts";
import { AccessService } from "./access-service.ts";
import type { ServiceContext } from "./types.ts";

export interface CreateOriginArtifactInput {
  bytes: Uint8Array;
  mime: string;
  label?: string;
}

export class OriginArtifactsService {
  private readonly db: Database;
  private readonly access: AccessService;
  private readonly actor: ServiceContext["actor"];
  private readonly blobs: BlobStore;

  constructor(context: ServiceContext & { blobs: BlobStore }) {
    this.db = context.db;
    this.access = new AccessService(context);
    this.actor = context.actor;
    this.blobs = context.blobs;
  }

  async findById(uuid: string): Promise<DbOriginArtifact | undefined> {
    return this.db.query.originArtifacts.findFirst({
      where: eq(originArtifacts.uuid, uuid),
    });
  }

  async createOriginArtifact(input: CreateOriginArtifactInput): Promise<DbOriginArtifact> {
    if (this.actor.kind !== "user") throw grantMissing("owner");

    const originArtifactUuid = uuidv7();
    const contentHashValue = await contentHash(input.bytes);
    const uploadedAt = new Date();
    await this.blobs.put("origins", contentHashValue, input.bytes, input.mime);

    const newOriginArtifact: NewDbOriginArtifact = {
      uuid: originArtifactUuid,
      ownerUuid: this.actor.uuid,
      contentHash: contentHashValue,
      mime: input.mime,
      byteSize: input.bytes.byteLength,
      label: input.label,
      rnetSchema: RNET_SCHEMA_VERSION,
      uploadedAt,
    };
    const [originArtifact] = await this.db
      .insert(originArtifacts)
      .values(newOriginArtifact)
      .returning();
    if (!originArtifact) throw new Error("Origin artifact insert did not return a row");
    return originArtifact;
  }

  async getOriginArtifact(uuid: string): Promise<DbOriginArtifact> {
    const originArtifact = await this.findById(uuid);
    if (!originArtifact || originArtifact.tombstonedAt) throw notFound("Origin");
    await this.access.assertRecordOwner(originArtifact.ownerUuid);
    return originArtifact;
  }

  async deleteOriginArtifact(uuid: string): Promise<void> {
    const originArtifact = await this.findById(uuid);
    if (!originArtifact || originArtifact.tombstonedAt) throw notFound("Origin");
    await this.access.assertRecordOwner(originArtifact.ownerUuid);
    const [tombstonedOriginArtifact] = await this.db
      .update(originArtifacts)
      .set({ tombstonedAt: new Date() })
      .where(and(eq(originArtifacts.uuid, uuid), isNull(originArtifacts.tombstonedAt)))
      .returning({ uuid: originArtifacts.uuid });
    if (!tombstonedOriginArtifact) throw notFound("Origin");
  }
}
