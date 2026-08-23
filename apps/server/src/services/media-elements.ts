import { RNET_SCHEMA_VERSION } from "@rnet/types";
import { eq } from "drizzle-orm";

import type { Database } from "../db/index.ts";
import { mediaElements } from "../db/models/media-element.ts";
import { grantMissing, notFound } from "../errors.ts";
import { AccessService } from "./access.ts";
import type { ServiceContext } from "./types.ts";

export type DbMediaElement = typeof mediaElements.$inferSelect;

export interface CreateMediaElementInput {
  uuid: string;
  ownerUuid: string;
  contentHash: string;
  kind: string;
  mime: string;
  byteSize: number;
  createdBy: string;
}

export class MediaElementService {
  private readonly db: Database;
  private readonly access: AccessService;

  constructor(context: ServiceContext) {
    this.db = context.db;
    this.access = new AccessService(context);
  }

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
        rnetSchema: RNET_SCHEMA_VERSION,
        createdBy: input.createdBy,
      })
      .returning();
    if (!mediaElementRecord) throw new Error("Media element metadata was not stored");
    return mediaElementRecord;
  }

  async getMediaElement(uuid: string): Promise<DbMediaElement> {
    if (!(await this.access.canReadMediaElement(uuid))) throw grantMissing("read");
    const [mediaElementRecord] = await this.db
      .select()
      .from(mediaElements)
      .where(eq(mediaElements.uuid, uuid));
    if (!mediaElementRecord || mediaElementRecord.tombstonedAt) throw notFound("Element");
    return mediaElementRecord;
  }
}
