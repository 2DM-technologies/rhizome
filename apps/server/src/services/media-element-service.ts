import type { MediaElement } from "@rnet/types";
import { eq } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "../db/index.ts";
import { GRANT_SCOPE } from "../db/models/grant.ts";
import { mediaElements, type MediaElementKind } from "../db/models/media-element.ts";
import { grantMissing, notFound } from "../errors.ts";
import { AccessService } from "./access-service.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";

export type DbMediaElement = typeof mediaElements.$inferSelect;

export interface PendingMediaElementUpload {
  bytes: Uint8Array;
  mime?: string;
}

export type PersistableMediaElement = MediaElement &
  Required<Pick<MediaElement, "byte_size" | "created_at">>;

export interface CreateMediaElementInput {
  mediaElement: PersistableMediaElement;
  transaction?: DatabaseTransaction;
}

export class MediaElementService {
  private readonly db: Database;
  private readonly access: AccessService;
  private readonly actor: ServiceContext["actor"];

  constructor(context: ServiceContext) {
    this.db = context.db;
    this.access = new AccessService(context);
    this.actor = context.actor;
  }

  async createMediaElement({
    mediaElement,
    transaction,
  }: CreateMediaElementInput): Promise<DbMediaElement> {
    const database = transaction ?? this.db;
    const [mediaElementRecord] = await database
      .insert(mediaElements)
      .values({
        uuid: uriId(mediaElement.uri),
        ownerUuid: uriId(mediaElement.owner),
        contentHash: mediaElement.content_hash,
        kind: mediaElement.kind as MediaElementKind,
        mime: mediaElement.mime,
        byteSize: mediaElement.byte_size,
        rnetSchema: mediaElement.rnet_schema,
        createdAt: new Date(mediaElement.created_at),
        createdBy: this.actor.subject,
      })
      .returning();
    if (!mediaElementRecord) throw new Error("Media element metadata was not stored");
    return mediaElementRecord;
  }

  async getMediaElement(uuid: string): Promise<DbMediaElement> {
    if (!(await this.access.canReadMediaElement(uuid))) throw grantMissing(GRANT_SCOPE.READ);
    const [mediaElementRecord] = await this.db
      .select()
      .from(mediaElements)
      .where(eq(mediaElements.uuid, uuid));
    if (!mediaElementRecord || mediaElementRecord.tombstonedAt) throw notFound("Element");
    return mediaElementRecord;
  }
}
