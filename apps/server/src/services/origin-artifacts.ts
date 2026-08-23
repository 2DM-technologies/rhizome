import { eq } from "drizzle-orm";

import type { Actor } from "../auth.ts";
import type { Database } from "../db/index.ts";
import { originArtifacts } from "../db/models/origin-artifact.ts";
import { notFound } from "../errors.ts";
import type { AccessService } from "./access.ts";

export type DbOriginArtifact = typeof originArtifacts.$inferSelect;

export interface CreateOriginArtifactInput {
  uuid: string;
  ownerUuid: string;
  contentHash: string;
  mime: string;
  byteSize: number;
  label?: string;
}

export class OriginArtifactService {
  constructor(
    private readonly db: Database,
    private readonly access: AccessService,
  ) {}

  async createOriginArtifact(actor: Actor, input: CreateOriginArtifactInput): Promise<DbOriginArtifact> {
    await this.access.assertRecordOwner(actor, input.ownerUuid);
    const [originArtifact] = await this.db
      .insert(originArtifacts)
      .values({
        uuid: input.uuid,
        ownerUuid: input.ownerUuid,
        contentHash: input.contentHash,
        mime: input.mime,
        byteSize: input.byteSize,
        label: input.label,
        rnetSchema: "0.1",
      })
      .returning();
    if (!originArtifact) throw new Error("Origin artifact metadata was not stored");
    return originArtifact;
  }

  async getOriginArtifact(actor: Actor, uuid: string): Promise<DbOriginArtifact> {
    const [originArtifact] = await this.db
      .select()
      .from(originArtifacts)
      .where(eq(originArtifacts.uuid, uuid));
    if (!originArtifact || originArtifact.tombstonedAt) throw notFound("Origin");
    await this.access.assertRecordOwner(actor, originArtifact.ownerUuid);
    return originArtifact;
  }
}
