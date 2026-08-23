import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { validateMediaObject, validateSchema, type Grant, type MediaObject, type Vibe } from "@rnet/types";
import { v7 as uuidv7 } from "uuid";

import type { Actor } from "./auth.ts";
import { DEV_MACHINE_UUID, DEV_USER_UUID } from "./auth.ts";
import type { Database } from "./db/index.ts";
import {
  elements,
  grants,
  machines,
  objectElements,
  objectOrigins,
  objectRevisions,
  objects,
  origins,
  users,
  vibeObjects,
  vibeRevisions,
  vibes,
} from "./db/schema.ts";
import { grantMissing, notFound, Problem } from "./errors.ts";

type Scope = Grant["scope"][number];
type DbObject = typeof objects.$inferSelect;
type DbVibe = typeof vibes.$inferSelect;

export class Store {
  constructor(readonly db: Database) {}

  async seedDevelopmentIdentities(): Promise<void> {
    await this.db
      .insert(users)
      .values({ uuid: DEV_USER_UUID, handle: "noah", name: "Development User" })
      .onConflictDoNothing();
    await this.db
      .insert(machines)
      .values({
        uuid: DEV_MACHINE_UUID,
        name: "rbudget",
        trust: "standard",
        codeHash: `sha256:${"0".repeat(64)}`,
        manifest: { seeded: true },
      })
      .onConflictDoNothing();
  }

  async assertAuthenticated(actor: Actor): Promise<void> {
    if (actor.kind === "public") {
      throw new Problem(401, "authentication_required", "Authentication required", "Sign in to continue");
    }
  }

  async assertOwner(actor: Actor, vibeUuid?: string): Promise<void> {
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
      .where(
        and(eq(grants.vibeUuid, vibeUuid), eq(grants.subject, actor.subject), isNull(grants.revokedAt)),
      );
    if (!grant?.scopes.includes(scope)) throw grantMissing(scope);
    return vibe;
  }

  async canReadObject(actor: Actor, objectUuid: string): Promise<boolean> {
    const [record] = await this.db
      .select({ ownerUuid: objects.ownerUuid })
      .from(objects)
      .where(eq(objects.uuid, objectUuid));
    if (!record) return false;
    if (actor.kind === "user" && actor.uuid === record.ownerUuid) return true;
    const memberships = await this.db
      .select({ vibeUuid: vibeObjects.vibeUuid })
      .from(vibeObjects)
      .where(eq(vibeObjects.objectUuid, objectUuid));
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

  async assertObjectScope(actor: Actor, objectUuid: string, scope: Scope): Promise<void> {
    const [record] = await this.db
      .select({ ownerUuid: objects.ownerUuid })
      .from(objects)
      .where(eq(objects.uuid, objectUuid));
    if (!record) throw notFound("Object");
    if (actor.kind === "user" && actor.uuid === record.ownerUuid) return;
    const memberships = await this.db
      .select({ vibeUuid: vibeObjects.vibeUuid })
      .from(vibeObjects)
      .where(eq(vibeObjects.objectUuid, objectUuid));
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

  async listVibes(actor: Actor): Promise<Vibe[]> {
    const rows =
      actor.kind === "user"
        ? await this.db.select().from(vibes).where(eq(vibes.ownerUuid, actor.uuid)).orderBy(asc(vibes.createdAt))
        : await this.db
            .select({ vibe: vibes })
            .from(vibes)
            .innerJoin(grants, eq(grants.vibeUuid, vibes.uuid))
            .where(
              and(
                eq(grants.subject, actor.subject),
                isNull(grants.revokedAt),
                sql`${grants.scopes} @> '["read"]'::jsonb`,
              ),
            )
            .orderBy(asc(vibes.createdAt))
            .then((items) => items.map((item) => item.vibe));
    return Promise.all(rows.map((row) => this.vibeDocument(row)));
  }

  async createVibe(
    actor: Actor,
    input: { title?: unknown; pull?: unknown; grants?: unknown },
  ): Promise<Vibe> {
    await this.assertAuthenticated(actor);
    if (actor.kind !== "user") throw grantMissing("owner");
    const uuid = uuidv7();
    const candidate = {
      rnet_schema: "0.1",
      uri: `rnet://vibe/${uuid}`,
      title: input.title,
      owner: `rnet://id/${actor.uuid}`,
      objects: [],
      ...(input.pull === undefined ? {} : { pull: input.pull }),
      ...(input.grants === undefined ? {} : { grants: input.grants }),
    };
    const validation = validateSchema("vibe", candidate);
    if (!validation.ok) throw schemaProblem(validation.issues);
    const document = validation.value;
    await this.assertGrantSubjects(document.grants ?? []);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(vibes)
        .values({
          uuid,
          title: document.title,
          ownerUuid: actor.uuid,
          rnetSchema: document.rnet_schema,
          pullConfig: document.pull,
          inferred: document.inferred ?? {},
        })
        .returning();
      if (!row) throw new Error("Vibe insert did not return a row");
      if (document.grants?.length) {
        await tx.insert(grants).values(
          document.grants.map((grant) => ({ vibeUuid: uuid, subject: grant.subject, scopes: grant.scope })),
        );
      }
      await tx.insert(vibeRevisions).values({
        vibeUuid: uuid,
        rev: 1,
        actor: actor.subject,
        snapshot: snapshotVibe(row, document.grants ?? []),
        membershipDelta: { added: [], removed: [] },
      });
      return document;
    });
  }

  async getVibe(actor: Actor, uuid: string): Promise<Vibe> {
    const row = await this.assertVibeScope(actor, uuid, "read");
    return this.vibeDocument(row);
  }

  async updateVibe(actor: Actor, uuid: string, patch: Record<string, unknown>): Promise<Vibe> {
    await this.assertOwner(actor, uuid);
    const current = await this.getVibe(actor, uuid);
    const allowed = new Set(["title", "pull", "grants"]);
    const extra = Object.keys(patch).find((key) => !allowed.has(key));
    if (extra) throw schemaProblem([{ instancePath: `/${extra}`, message: "property is not patchable" }]);
    const candidate = { ...current, ...patch };
    const validation = validateSchema("vibe", candidate);
    if (!validation.ok) throw schemaProblem(validation.issues);
    const document = validation.value;
    await this.assertGrantSubjects(document.grants ?? []);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(vibes)
        .set({ title: document.title, pullConfig: document.pull, rev: sql`${vibes.rev} + 1` })
        .where(eq(vibes.uuid, uuid))
        .returning();
      if (!row) throw notFound("Vibe");
      if (patch.grants !== undefined) {
        const existing = await tx.select().from(grants).where(eq(grants.vibeUuid, uuid));
        const next = new Map((document.grants ?? []).map((grant) => [grant.subject, grant]));
        const now = new Date();
        for (const grant of existing) {
          const replacement = next.get(grant.subject);
          if (replacement) {
            await tx
              .update(grants)
              .set({
                scopes: replacement.scope,
                revokedAt: null,
                ...(grant.revokedAt ? { grantedAt: now } : {}),
              })
              .where(and(eq(grants.vibeUuid, uuid), eq(grants.subject, grant.subject)));
            next.delete(grant.subject);
          } else if (!grant.revokedAt) {
            await tx
              .update(grants)
              .set({ revokedAt: now })
              .where(and(eq(grants.vibeUuid, uuid), eq(grants.subject, grant.subject)));
          }
        }
        if (next.size) {
          await tx.insert(grants).values(
            [...next.values()].map((grant) => ({ vibeUuid: uuid, subject: grant.subject, scopes: grant.scope })),
          );
        }
      }
      await tx.insert(vibeRevisions).values({
        vibeUuid: uuid,
        rev: row.rev,
        actor: actor.subject,
        snapshot: snapshotVibe(row, document.grants ?? []),
      });
      return document;
    });
  }

  async deleteVibe(actor: Actor, uuid: string): Promise<void> {
    await this.assertOwner(actor, uuid);
    await this.db.delete(vibes).where(eq(vibes.uuid, uuid));
  }

  async listVibeObjects(actor: Actor, vibeUuid: string): Promise<MediaObject[]> {
    await this.assertVibeScope(actor, vibeUuid, "read");
    const rows = await this.db
      .select({ object: objects })
      .from(vibeObjects)
      .innerJoin(objects, eq(objects.uuid, vibeObjects.objectUuid))
      .where(eq(vibeObjects.vibeUuid, vibeUuid))
      .orderBy(asc(vibeObjects.position), asc(vibeObjects.addedAt));
    return Promise.all(rows.map((row) => this.objectDocument(row.object)));
  }

  async getObject(actor: Actor, uuid: string): Promise<{ document: MediaObject; userRev: number }> {
    const [row] = await this.db.select().from(objects).where(eq(objects.uuid, uuid));
    if (!row) throw notFound("Object");
    if (!(await this.canReadObject(actor, uuid))) throw grantMissing("read");
    return { document: await this.objectDocument(row), userRev: row.userRev };
  }

  async createObjects(
    actor: Actor,
    body: { vibe?: unknown; objects?: unknown },
  ): Promise<MediaObject[]> {
    await this.assertAuthenticated(actor);
    if (!Array.isArray(body.objects) || body.objects.length === 0) {
      throw schemaProblem([{ instancePath: "/objects", message: "must be a non-empty array" }]);
    }
    const vibeUuid = typeof body.vibe === "string" ? uriId(body.vibe) : undefined;
    let targetVibe: DbVibe | undefined;
    if (actor.kind === "client") {
      if (!vibeUuid) throw schemaProblem([{ instancePath: "/vibe", message: "is required for clients" }]);
      targetVibe = await this.assertVibeScope(actor, vibeUuid, "write:objects");
    } else if (vibeUuid) {
      targetVibe = await this.assertVibeScope(actor, vibeUuid, "write:objects");
    }
    const ownerUuid = targetVibe?.ownerUuid ?? (actor.kind === "user" ? actor.uuid : undefined);
    if (!ownerUuid) throw grantMissing("owner");
    const actorOwnsRecords = actor.kind === "user" && actor.uuid === ownerUuid;

    const documents = body.objects.map((item, index) =>
      this.normalizeObject(actor, ownerUuid, item, index),
    );
    for (const document of documents) {
      await this.assertObjectReferences(actor, vibeUuid, ownerUuid, document);
    }

    return this.db.transaction(async (tx) => {
      const created: MediaObject[] = [];
      let nextVibePosition: number | undefined;
      if (vibeUuid) {
        await tx.execute(sql`SELECT 1 FROM ${vibes} WHERE ${vibes.uuid} = ${vibeUuid}::uuid FOR UPDATE`);
        const [maxRow] = await tx
          .select({ max: sql<number>`coalesce(max(${vibeObjects.position}), -1)::int` })
          .from(vibeObjects)
          .where(eq(vibeObjects.vibeUuid, vibeUuid));
        nextVibePosition = (maxRow?.max ?? -1) + 1;
      }
      for (const [documentIndex, document] of documents.entries()) {
        const uuid = uriId(document.uri);
        const extensions = Object.fromEntries(
          Object.entries(document).filter(([key]) => key.startsWith("x-")),
        );
        await tx.insert(objects).values({
          uuid,
          ownerUuid,
          createdBy: actor.subject,
          createdForVibe: actorOwnsRecords ? null : vibeUuid,
          type: document.type,
          keys: document.keys ?? {},
          source: document.source,
          user: document.user,
          inferred: document.inferred ?? {},
          extensions,
          rnetSchema: document.rnet_schema,
        });
        if (document.elements.length) {
          await tx.insert(objectElements).values(
            document.elements.map((uri, position) => ({
              objectUuid: uuid,
              elementUuid: uriId(uri),
              position,
            })),
          );
        }
        await tx.insert(objectOrigins).values(
          document.source.origins.map((uri) =>
            uri.startsWith("rnet://origin/")
              ? { objectUuid: uuid, artifactUuid: uriId(uri) }
              : { objectUuid: uuid, machineUuid: uriId(uri) },
          ),
        );
        await tx.insert(objectRevisions).values({
          objectUuid: uuid,
          block: "source",
          rev: 1,
          snapshot: document.source,
          actor: actor.subject,
        });
        if (vibeUuid && nextVibePosition !== undefined) {
          await tx.insert(vibeObjects).values({
            vibeUuid,
            objectUuid: uuid,
            position: nextVibePosition + documentIndex,
          });
        }
        created.push(document);
      }
      return created;
    });
  }

  async addObjectRefs(actor: Actor, vibeUuid: string, refs: unknown): Promise<void> {
    const targetVibe = await this.assertVibeScope(actor, vibeUuid, "write:objects");
    if (!Array.isArray(refs) || !refs.every((ref) => typeof ref === "string")) {
      throw schemaProblem([{ instancePath: "/objects", message: "must be an array of object URIs" }]);
    }
    const ids = refs.map(uriId);
    if (new Set(ids).size !== ids.length) {
      throw schemaProblem([{ instancePath: "/objects", message: "must not contain duplicate object URIs" }]);
    }
    const actorIsOwner = actor.kind === "user" && actor.uuid === targetVibe.ownerUuid;
    for (const id of ids) {
      const [record] = await this.db
        .select({
          ownerUuid: objects.ownerUuid,
          createdBy: objects.createdBy,
          createdForVibe: objects.createdForVibe,
        })
        .from(objects)
        .where(eq(objects.uuid, id));
      if (!record) throw notFound("Object");
      if (record.ownerUuid !== targetVibe.ownerUuid) throw grantMissing("owner");
      if (!actorIsOwner && (record.createdBy !== actor.subject || record.createdForVibe !== vibeUuid)) {
        throw grantMissing("write:objects");
      }
      const [membership] = await this.db
        .select({ objectUuid: vibeObjects.objectUuid })
        .from(vibeObjects)
        .where(and(eq(vibeObjects.vibeUuid, vibeUuid), eq(vibeObjects.objectUuid, id)));
      if (membership) {
        throw schemaProblem([{ instancePath: "/objects", message: `object is already in the Vibe: ${id}` }]);
      }
    }
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM ${vibes} WHERE ${vibes.uuid} = ${vibeUuid}::uuid FOR UPDATE`);
      const [maxRow] = await tx
        .select({ max: sql<number>`coalesce(max(${vibeObjects.position}), -1)::int` })
        .from(vibeObjects)
        .where(eq(vibeObjects.vibeUuid, vibeUuid));
      const firstPosition = (maxRow?.max ?? -1) + 1;
      await tx
        .insert(vibeObjects)
        .values(ids.map((objectUuid, index) => ({ vibeUuid, objectUuid, position: firstPosition + index })));
      const [row] = await tx
        .update(vibes)
        .set({ rev: sql`${vibes.rev} + 1` })
        .where(eq(vibes.uuid, vibeUuid))
        .returning();
      if (row) {
        const grantRows = await tx
          .select()
          .from(grants)
          .where(and(eq(grants.vibeUuid, vibeUuid), isNull(grants.revokedAt)));
        await tx.insert(vibeRevisions).values({
          vibeUuid,
          rev: row.rev,
          actor: actor.subject,
          snapshot: snapshotVibe(
            row,
            grantRows.map((grant) => ({ subject: grant.subject, scope: grant.scopes })),
          ),
          membershipDelta: { added: refs as string[], removed: [] },
        });
      }
    });
  }

  async removeObjectRefs(actor: Actor, vibeUuid: string, refs: unknown): Promise<void> {
    await this.assertOwner(actor, vibeUuid);
    if (!Array.isArray(refs) || !refs.every((ref) => typeof ref === "string")) {
      throw schemaProblem([{ instancePath: "/objects", message: "must be an array of object URIs" }]);
    }
    const ids = refs.map(uriId);
    await this.db.transaction(async (tx) => {
      if (ids.length) {
        await tx
          .delete(vibeObjects)
          .where(and(eq(vibeObjects.vibeUuid, vibeUuid), inArray(vibeObjects.objectUuid, ids)));
      }
      const [row] = await tx
        .update(vibes)
        .set({ rev: sql`${vibes.rev} + 1` })
        .where(eq(vibes.uuid, vibeUuid))
        .returning();
      if (row) {
        const grantRows = await tx
          .select()
          .from(grants)
          .where(and(eq(grants.vibeUuid, vibeUuid), isNull(grants.revokedAt)));
        await tx.insert(vibeRevisions).values({
          vibeUuid,
          rev: row.rev,
          actor: actor.subject,
          snapshot: snapshotVibe(
            row,
            grantRows.map((grant) => ({ subject: grant.subject, scope: grant.scopes })),
          ),
          membershipDelta: { added: [], removed: refs as string[] },
        });
      }
    });
  }

  async setUser(
    actor: Actor,
    uuid: string,
    expectedRev: number,
    value: unknown,
  ): Promise<{ document: MediaObject; userRev: number }> {
    await this.assertObjectScope(actor, uuid, "write:user");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw schemaProblem([{ instancePath: "/", message: "must be an object" }]);
    }
    const extra = Object.keys(value).find((key) => key !== "properties");
    if (extra) throw schemaProblem([{ instancePath: `/${extra}`, message: "cannot be written through write:user" }]);
    const properties = (value as Record<string, unknown>).properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      throw schemaProblem([{ instancePath: "/properties", message: "must be an object" }]);
    }
    const candidate: NonNullable<MediaObject["user"]> = {
      properties: properties as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    };
    const updated = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM ${objects} WHERE ${objects.uuid} = ${uuid}::uuid FOR UPDATE`);
      const [current] = await tx.select().from(objects).where(eq(objects.uuid, uuid));
      if (!current) throw notFound("Object");
      const refs = await tx
        .select({ uuid: objectElements.elementUuid })
        .from(objectElements)
        .where(eq(objectElements.objectUuid, uuid))
        .orderBy(asc(objectElements.position));
      const fullCandidate = this.objectDocumentFromRefs(
        { ...current, user: candidate },
        refs.map((ref) => ref.uuid),
      );
      const validation = validateMediaObject(fullCandidate);
      if (!validation.ok) throw schemaProblem(validation.issues);
      if (current.userRev !== expectedRev) {
        throw new Problem(409, "revision_conflict", "Revision conflict", "The user block changed", {
          expected: expectedRev,
          current: current.userRev,
        });
      }
      const [next] = await tx
        .update(objects)
        .set({ user: candidate, userRev: sql`${objects.userRev} + 1` })
        .where(and(eq(objects.uuid, uuid), eq(objects.userRev, expectedRev)))
        .returning();
      if (!next) throw new Problem(409, "revision_conflict", "Revision conflict", "The user block changed");
      await tx.insert(objectRevisions).values({
        objectUuid: uuid,
        block: "user",
        rev: next.userRev,
        snapshot: candidate,
        actor: actor.subject,
      });
      return next;
    });
    return { document: await this.objectDocument(updated), userRev: updated.userRev };
  }

  async setInferred(actor: Actor, uuid: string, body: Record<string, unknown>): Promise<MediaObject> {
    await this.assertObjectScope(actor, uuid, "write:inferred");
    const task = body.task;
    const entry = body.entry;
    if (typeof task !== "string" || !entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw schemaProblem([{ instancePath: "/", message: "task and entry are required" }]);
    }
    const key = actor.kind === "client" ? `${actor.name}:${task}` : task;
    if (actor.kind === "client" && task.includes(":")) {
      throw new Problem(403, "writer_namespace_mismatch", "Writer namespace mismatch", "Pass a bare task name");
    }
    const updated = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM ${objects} WHERE ${objects.uuid} = ${uuid}::uuid FOR UPDATE`);
      const [current] = await tx.select().from(objects).where(eq(objects.uuid, uuid));
      if (!current) throw notFound("Object");
      const inferred: NonNullable<MediaObject["inferred"]> = {
        ...current.inferred,
        [key]: entry as NonNullable<MediaObject["inferred"]>[string],
      };
      const refs = await tx
        .select({ uuid: objectElements.elementUuid })
        .from(objectElements)
        .where(eq(objectElements.objectUuid, uuid))
        .orderBy(asc(objectElements.position));
      const candidate = this.objectDocumentFromRefs(
        { ...current, inferred },
        refs.map((ref) => ref.uuid),
      );
      const validation = validateMediaObject(candidate);
      if (!validation.ok) throw schemaProblem(validation.issues);
      const maxRow = (await tx
        .select({ max: sql<number>`coalesce(max(${objectRevisions.rev}), 0)::int` })
        .from(objectRevisions)
        .where(and(eq(objectRevisions.objectUuid, uuid), eq(objectRevisions.block, "inferred"))))[0];
      const [next] = await tx.update(objects).set({ inferred }).where(eq(objects.uuid, uuid)).returning();
      if (!next) throw notFound("Object");
      await tx.insert(objectRevisions).values({
        objectUuid: uuid,
        block: "inferred",
        rev: (maxRow?.max ?? 0) + 1,
        snapshot: inferred,
        actor: actor.subject,
      });
      return next;
    });
    return this.objectDocument(updated);
  }

  async canReadElement(actor: Actor, elementUuid: string): Promise<boolean> {
    const [element] = await this.db
      .select({ ownerUuid: elements.ownerUuid })
      .from(elements)
      .where(eq(elements.uuid, elementUuid));
    if (!element) return false;
    if (actor.kind === "user" && actor.uuid === element.ownerUuid) return true;
    const refs = await this.db
      .select({ objectUuid: objectElements.objectUuid })
      .from(objectElements)
      .where(eq(objectElements.elementUuid, elementUuid));
    for (const ref of refs) if (await this.canReadObject(actor, ref.objectUuid)) return true;
    return false;
  }

  private normalizeObject(actor: Actor, ownerUuid: string, input: unknown, index: number): MediaObject {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw schemaProblem([{ instancePath: `/objects/${index}`, message: "must be an object" }]);
    }
    const raw = input as Record<string, unknown>;
    const uuid = typeof raw.uri === "string" ? uriId(raw.uri) : uuidv7();
    const owner = `rnet://id/${ownerUuid}`;
    if (raw.owner !== undefined && raw.owner !== owner) {
      throw schemaProblem([{ instancePath: `/objects/${index}/owner`, message: "conflicts with the store-assigned owner" }]);
    }
    const candidate =
      actor.kind === "client"
        ? {
            rnet_schema: "0.1",
            uri: `rnet://object/${uuid}`,
            owner,
            type: raw.type,
            elements: raw.elements ?? [],
            ...(raw.keys === undefined ? {} : { keys: raw.keys }),
            source: {
              ingest: { method: "authored", reproducible: false },
              origins: [`rnet://client/${actor.uuid}`],
              properties: raw.properties ?? {},
            },
          }
        : { ...raw, owner };
    const validation = validateMediaObject(candidate);
    if (!validation.ok) throw schemaProblem(validation.issues, `/objects/${index}`);
    if (validation.value.user !== undefined || Object.keys(validation.value.inferred ?? {}).length) {
      throw schemaProblem([{ instancePath: `/objects/${index}`, message: "creation cannot write user or inferred" }]);
    }
    const ingest = validation.value.source.ingest;
    const allowedStamp =
      (ingest.method === "parser" && ingest.reproducible === true) ||
      (ingest.method === "authored" && ingest.reproducible === false);
    if (!allowedStamp) {
      throw new Problem(
        422,
        "ingest_nonconformant",
        "Ingest record is not reachable in M1",
        "M1 accepts parser/reproducible or authored/non-reproducible creation stamps",
      );
    }
    return validation.value;
  }

  private async assertObjectReferences(
    actor: Actor,
    vibeUuid: string | undefined,
    ownerUuid: string,
    document: MediaObject,
  ): Promise<void> {
    for (const uri of document.elements) {
      const elementUuid = uriId(uri);
      const [row] = await this.db
        .select({
          uuid: elements.uuid,
          ownerUuid: elements.ownerUuid,
          createdBy: elements.createdBy,
          createdForVibe: elements.createdForVibe,
        })
        .from(elements)
        .where(eq(elements.uuid, elementUuid));
      if (!row) throw schemaProblem([{ instancePath: "/elements", message: `unknown element ${uri}` }]);
      if (row.ownerUuid !== ownerUuid) throw grantMissing("owner");
      const actorOwnsRecord = actor.kind === "user" && actor.uuid === ownerUuid;
      if (!actorOwnsRecord) {
        const createdForTarget = row.createdBy === actor.subject && row.createdForVibe === vibeUuid;
        const readableInTarget = vibeUuid
          ? await this.canReadElementInVibe(actor, elementUuid, vibeUuid)
          : false;
        if (!createdForTarget && !readableInTarget) throw grantMissing("read");
      }
    }
    for (const uri of document.source.origins) {
      if (uri.startsWith("rnet://origin/")) {
        const [row] = await this.db
          .select({ uuid: origins.uuid, ownerUuid: origins.ownerUuid })
          .from(origins)
          .where(eq(origins.uuid, uriId(uri)));
        if (!row) throw schemaProblem([{ instancePath: "/source/origins", message: `unknown origin ${uri}` }]);
        if (row.ownerUuid !== ownerUuid) throw grantMissing("owner");
      } else {
        const [row] = await this.db.select({ uuid: machines.uuid }).from(machines).where(eq(machines.uuid, uriId(uri)));
        if (!row) throw schemaProblem([{ instancePath: "/source/origins", message: `unknown client ${uri}` }]);
      }
    }
  }

  private async canReadElementInVibe(
    actor: Actor,
    elementUuid: string,
    vibeUuid: string,
  ): Promise<boolean> {
    try {
      await this.assertVibeScope(actor, vibeUuid, "read");
    } catch (error) {
      if (error instanceof Problem && [403, 404].includes(error.status)) return false;
      throw error;
    }
    const [membership] = await this.db
      .select({ objectUuid: objectElements.objectUuid })
      .from(objectElements)
      .innerJoin(vibeObjects, eq(vibeObjects.objectUuid, objectElements.objectUuid))
      .where(
        and(
          eq(objectElements.elementUuid, elementUuid),
          eq(vibeObjects.vibeUuid, vibeUuid),
        ),
      );
    return Boolean(membership);
  }

  private async assertGrantSubjects(candidateGrants: Grant[]): Promise<void> {
    const seen = new Set<string>();
    for (const grant of candidateGrants) {
      if (seen.has(grant.subject)) {
        throw schemaProblem([{ instancePath: "/grants", message: `duplicate subject ${grant.subject}` }]);
      }
      seen.add(grant.subject);
      if (grant.subject === "public") continue;
      if (grant.subject.startsWith("client:")) {
        const name = grant.subject.slice("client:".length);
        const [machine] = await this.db.select({ uuid: machines.uuid }).from(machines).where(eq(machines.name, name));
        if (machine) continue;
      } else if (grant.subject.startsWith("id:rnet://id/")) {
        const uuid = grant.subject.slice("id:rnet://id/".length);
        const [user] = await this.db.select({ uuid: users.uuid }).from(users).where(eq(users.uuid, uuid));
        if (user) continue;
      }
      throw new Problem(
        422,
        "schema_violation",
        "Unknown grant subject",
        `This store cannot resolve ${grant.subject}`,
        { errors: [{ pointer: "/grants", message: "unknown subject namespace or identity" }] },
      );
    }
  }

  private async objectDocument(row: DbObject): Promise<MediaObject> {
    const refs = await this.db
      .select({ uuid: objectElements.elementUuid })
      .from(objectElements)
      .where(eq(objectElements.objectUuid, row.uuid))
      .orderBy(asc(objectElements.position));
    return this.objectDocumentFromRefs(row, refs.map((ref) => ref.uuid));
  }

  private objectDocumentFromRefs(row: DbObject, elementUuids: string[]): MediaObject {
    return {
      rnet_schema: "0.1",
      uri: `rnet://object/${row.uuid}`,
      owner: `rnet://id/${row.ownerUuid}`,
      type: row.type,
      elements: elementUuids.map((uuid) => `rnet://element/${uuid}`),
      ...(Object.keys(row.keys).length ? { keys: row.keys } : {}),
      source: row.source,
      ...(row.user ? { user: row.user } : {}),
      ...(Object.keys(row.inferred).length ? { inferred: row.inferred } : {}),
      ...row.extensions,
    } as MediaObject;
  }

  private async vibeDocument(row: DbVibe): Promise<Vibe> {
    const [memberships, grantRows] = await Promise.all([
      this.db
        .select({ uuid: vibeObjects.objectUuid })
        .from(vibeObjects)
        .where(eq(vibeObjects.vibeUuid, row.uuid))
        .orderBy(asc(vibeObjects.position), asc(vibeObjects.addedAt)),
      this.db
        .select()
        .from(grants)
        .where(and(eq(grants.vibeUuid, row.uuid), isNull(grants.revokedAt))),
    ]);
    return {
      rnet_schema: "0.1",
      uri: `rnet://vibe/${row.uuid}`,
      title: row.title,
      owner: `rnet://id/${row.ownerUuid}`,
      objects: memberships.map((membership) => `rnet://object/${membership.uuid}`),
      created_at: row.createdAt.toISOString(),
      ...(row.pullConfig ? { pull: row.pullConfig } : {}),
      ...(grantRows.length
        ? { grants: grantRows.map((grant) => ({ subject: grant.subject, scope: grant.scopes })) }
        : {}),
      ...(Object.keys(row.inferred).length ? { inferred: row.inferred } : {}),
      ...row.extensions,
    } as Vibe;
  }
}

export function uriId(uri: string): string {
  const slash = uri.lastIndexOf("/");
  return slash >= 0 ? uri.slice(slash + 1) : uri;
}

function snapshotVibe(row: DbVibe, grantRows: Grant[]): Record<string, unknown> {
  return {
    title: row.title,
    inferred: row.inferred,
    pull_config: row.pullConfig,
    grants: grantRows,
  };
}

function schemaProblem(
  issues: readonly { instancePath?: string; schemaPath?: string; message: string }[],
  prefix = "",
): Problem {
  return new Problem(422, "schema_violation", "Schema violation", "The request does not conform", {
    errors: issues.map((issue) => ({
      pointer: `${prefix}${issue.instancePath ?? ""}` || "/",
      schema: issue.schemaPath,
      message: issue.message,
    })),
  });
}
