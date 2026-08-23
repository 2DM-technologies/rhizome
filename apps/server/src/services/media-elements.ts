import { eq } from "drizzle-orm";

import type { Actor } from "../auth.ts";
import type { Database } from "../db/index.ts";
import { mediaElements } from "../db/models/media-element.ts";
import { grantMissing, notFound } from "../errors.ts";
import type { AccessService } from "./access.ts";

export type DbMediaElement = typeof mediaElements.$inferSelect;

export interface CreateMediaElementInput {
  uuid: string;
  ownerUuid: string;
  contentHash: string;
  kind: string;
  mime: string;
  byteSize: number;
  createdBy: string;
  createdForVibe?: string;
}

export class MediaElementService {
  constructor(
    private readonly db: Database,
    private readonly access: AccessService,
  ) {}

  async createMediaElement(input: CreateMediaElementInput): Promise<DbMediaElement> {
    const [mediaElementRecord] = await this.db
      .insert(mediaElements)
      .values({
        uuid: input.uuid,
        ownerUuid: input.ownerUuid,
        contentHash: input.contentHash,
        kind: input.kind,
        mime: input.mime,
        byteSize: input.byteSize,
        rnetSchema: "0.1",
        createdBy: input.createdBy,
        createdForVibe: input.createdForVibe ?? null,
      })
      .returning();
    if (!mediaElementRecord) throw new Error("Media element metadata was not stored");
    return mediaElementRecord;
  }

  async getMediaElement(actor: Actor, uuid: string): Promise<DbMediaElement> {
    if (!(await this.access.canReadMediaElement(actor, uuid))) throw grantMissing("read");
    const [mediaElementRecord] = await this.db
      .select()
      .from(mediaElements)
      .where(eq(mediaElements.uuid, uuid));
    if (!mediaElementRecord || mediaElementRecord.tombstonedAt) throw notFound("Element");
    return mediaElementRecord;
  }
}
