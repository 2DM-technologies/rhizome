import type { Grant } from "@rnet/types";
import { and, eq, isNull } from "drizzle-orm";

import type { Actor } from "../auth.ts";
import type { Database } from "../db/index.ts";
import { grants } from "../db/models/grant.ts";
import { mediaObjectElements } from "../db/models/media-object-element.ts";
import { mediaElements } from "../db/models/media-element.ts";
import { mediaObjects } from "../db/models/media-object.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import { vibes } from "../db/models/vibe.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";

export type Scope = Grant["scope"][number];
export type DbVibe = typeof vibes.$inferSelect;

export class AccessService {
  constructor(private readonly db: Database) {}

  async assertAuthenticated(actor: Actor): Promise<void> {
    if (actor.kind === "public") {
      throw new Problem(401, "authentication_required", "Authentication required", "Sign in to continue");
    }
  }

  async assertVibeOwner(actor: Actor, vibeUuid?: string): Promise<void> {
    await this.assertAuthenticated(actor);
    if (actor.kind !== "user") throw grantMissing("owner");
    if (!vibeUuid) return;
    const [vibe] = await this.db.select({ ownerUuid: vibes.ownerUuid }).from(vibes).where(eq(vibes.uuid, vibeUuid));
    if (!vibe) throw notFound("Vibe");
    if (vibe.ownerUuid !== actor.uuid) throw grantMissing("owner");
  }

  async assertRecordOwner(actor: Actor, ownerUuid: string): Promise<void> {
    await this.assertAuthenticated(actor);
    if (actor.kind !== "user" || actor.uuid !== ownerUuid) throw grantMissing("owner");
  }

  async assertVibeScope(actor: Actor, vibeUuid: string, scope: Scope): Promise<DbVibe> {
    const [vibe] = await this.db.select().from(vibes).where(eq(vibes.uuid, vibeUuid));
    if (!vibe) throw notFound("Vibe");
    if (actor.kind === "user" && actor.uuid === vibe.ownerUuid) return vibe;

    const [grant] = await this.db
      .select({ scopes: grants.scopes })
      .from(grants)
      .where(and(eq(grants.vibeUuid, vibeUuid), eq(grants.subject, actor.subject), isNull(grants.revokedAt)));
    if (!grant?.scopes.includes(scope)) throw grantMissing(scope);
    return vibe;
  }

  async canReadMediaObject(actor: Actor, mediaObjectUuid: string): Promise<boolean> {
    const [mediaObjectRecord] = await this.db
      .select({ ownerUuid: mediaObjects.ownerUuid })
      .from(mediaObjects)
      .where(eq(mediaObjects.uuid, mediaObjectUuid));
    if (!mediaObjectRecord) return false;
    if (actor.kind === "user" && actor.uuid === mediaObjectRecord.ownerUuid) return true;
    const memberships = await this.db
      .select({ vibeUuid: vibeMediaObjects.vibeUuid })
      .from(vibeMediaObjects)
      .where(eq(vibeMediaObjects.mediaObjectUuid, mediaObjectUuid));
    for (const membership of memberships) {
      try {
        await this.assertVibeScope(actor, membership.vibeUuid, "read");
        return true;
      } catch (error) {
        if (!(error instanceof Problem) || ![403, 404].includes(error.status)) throw error;
      }
    }
    return false;
  }

  async assertMediaObjectScope(actor: Actor, mediaObjectUuid: string, scope: Scope): Promise<void> {
    const [mediaObjectRecord] = await this.db
      .select({ ownerUuid: mediaObjects.ownerUuid })
      .from(mediaObjects)
      .where(eq(mediaObjects.uuid, mediaObjectUuid));
    if (!mediaObjectRecord) throw notFound("Object");
    if (actor.kind === "user" && actor.uuid === mediaObjectRecord.ownerUuid) return;
    const memberships = await this.db
      .select({ vibeUuid: vibeMediaObjects.vibeUuid })
      .from(vibeMediaObjects)
      .where(eq(vibeMediaObjects.mediaObjectUuid, mediaObjectUuid));
    if (!memberships.length) throw grantMissing(scope);
    for (const membership of memberships) {
      try {
        await this.assertVibeScope(actor, membership.vibeUuid, scope);
        return;
      } catch (error) {
        if (!(error instanceof Problem) || ![403, 404].includes(error.status)) throw error;
      }
    }
    throw grantMissing(scope);
  }

  async canReadMediaElement(actor: Actor, mediaElementUuid: string): Promise<boolean> {
    const [mediaElementRecord] = await this.db
      .select({ ownerUuid: mediaElements.ownerUuid })
      .from(mediaElements)
      .where(eq(mediaElements.uuid, mediaElementUuid));
    if (!mediaElementRecord) return false;
    if (actor.kind === "user" && actor.uuid === mediaElementRecord.ownerUuid) return true;
    const references = await this.db
      .select({ mediaObjectUuid: mediaObjectElements.mediaObjectUuid })
      .from(mediaObjectElements)
      .where(eq(mediaObjectElements.mediaElementUuid, mediaElementUuid));
    for (const reference of references) {
      if (await this.canReadMediaObject(actor, reference.mediaObjectUuid)) return true;
    }
    return false;
  }
}
