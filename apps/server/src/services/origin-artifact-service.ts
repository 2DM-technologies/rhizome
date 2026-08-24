import { validateSchema, type OriginArtifact } from "@rnet/types";
import { eq } from "drizzle-orm";
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
import { schemaProblem } from "./problems.ts";
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

  async createOriginArtifact(input: CreateOriginArtifactInput): Promise<OriginArtifact> {
    if (this.actor.kind !== "user") throw grantMissing("owner");

    const originArtifactUuid = uuidv7();
    const contentHashValue = await contentHash(input.bytes);
    const uploadedAt = new Date();
    const candidateOriginArtifact = {
      rnet_schema: RNET_SCHEMA_VERSION,
      uri: `rnet://origin/${originArtifactUuid}`,
      owner: `rnet://id/${this.actor.uuid}`,
      content_hash: contentHashValue,
      mime: input.mime,
      bytes: await this.blobs.signedUrl("origins", contentHashValue),
      byte_size: input.bytes.byteLength,
      ...(input.label ? { label: input.label } : {}),
      uploaded_at: uploadedAt.toISOString(),
    };
    const validation = validateSchema("origin-artifact", candidateOriginArtifact);
    if (!validation.ok) throw schemaProblem(validation.issues);
    const originArtifactDocument = {
      ...candidateOriginArtifact,
      rnet_schema: validation.value.rnet_schema,
      mime: validation.value.mime,
      ...(validation.value.label === undefined ? {} : { label: validation.value.label }),
    } satisfies OriginArtifact;
    await this.blobs.put("origins", contentHashValue, input.bytes, originArtifactDocument.mime);

    const newOriginArtifact: NewDbOriginArtifact = {
      uuid: originArtifactUuid,
      ownerUuid: this.actor.uuid,
      contentHash: contentHashValue,
      mime: originArtifactDocument.mime,
      byteSize: input.bytes.byteLength,
      label: originArtifactDocument.label,
      rnetSchema: RNET_SCHEMA_VERSION,
      uploadedAt,
    };
    await this.db.insert(originArtifacts).values(newOriginArtifact);
    return originArtifactDocument;
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

  async getOriginArtifactDocument(uuid: string): Promise<OriginArtifact> {
    return this.toDocument(await this.getOriginArtifact(uuid));
  }

  private async toDocument(originArtifact: DbOriginArtifact): Promise<OriginArtifact> {
    return {
      rnet_schema: RNET_SCHEMA_VERSION,
      uri: `rnet://origin/${originArtifact.uuid}`,
      owner: `rnet://id/${originArtifact.ownerUuid}`,
      content_hash: originArtifact.contentHash,
      mime: originArtifact.mime,
      bytes: await this.blobs.signedUrl("origins", originArtifact.contentHash),
      byte_size: originArtifact.byteSize,
      ...(originArtifact.label ? { label: originArtifact.label } : {}),
      uploaded_at: originArtifact.uploadedAt.toISOString(),
    };
  }
}
