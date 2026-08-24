import { eq } from "drizzle-orm";

import type { Database } from "../db/index.ts";
import { originArtifacts } from "../db/models/origin-artifact.ts";
import { notFound } from "../errors.ts";
import { AccessService } from "./access-service.ts";
import type { ServiceContext } from "./types.ts";

export type DbOriginArtifact = typeof originArtifacts.$inferSelect;

export interface CreateOriginArtifactInput {
  uuid: string;
  ownerUuid: string;
  contentHash: string;
  mime: string;
  byteSize: number;
  label?: string;
  rnetSchema: string;
  uploadedAt: Date;
}

export class OriginArtifactsService {
  private readonly db: Database;
  private readonly access: AccessService;

  constructor(context: ServiceContext) {
    this.db = context.db;
    this.access = new AccessService(context);
  }

  async createOriginArtifact(input: CreateOriginArtifactInput): Promise<DbOriginArtifact> {
    await this.access.assertRecordOwner(input.ownerUuid);
    const [originArtifact] = await this.db
      .insert(originArtifacts)
      .values({
        uuid: input.uuid,
        ownerUuid: input.ownerUuid,
        contentHash: input.contentHash,
        mime: input.mime,
        byteSize: input.byteSize,
        label: input.label,
        rnetSchema: input.rnetSchema,
        uploadedAt: input.uploadedAt,
      })
      .returning();
    if (!originArtifact) throw new Error("Origin artifact metadata was not stored");
    return originArtifact;
  }

  async getOriginArtifact(uuid: string): Promise<DbOriginArtifact> {
    const [originArtifact] = await this.db
      .select()
      .from(originArtifacts)
      .where(eq(originArtifacts.uuid, uuid));
    if (!originArtifact || originArtifact.tombstonedAt) throw notFound("Origin");
    await this.access.assertRecordOwner(originArtifact.ownerUuid);
    return originArtifact;
  }
}
