import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { validateSchema } from "@rnet/types";
import { DEV_DMACHINE_UUID, DEV_USER_UUID, type UserActor } from "../src/auth.ts";
import { createDatabase } from "../src/db/index.ts";
import { operations } from "../src/db/models/operation.ts";
import { vibeRevisions } from "../src/db/models/vibe-revision.ts";
import { vibes } from "../src/db/models/vibe.ts";
import { seedDb } from "../src/db/seedDb.ts";
import { serializeVibe } from "../src/serializers/vibe-serializer.ts";
import { writeVibeTaskInferred } from "../src/services/inferred-writer.ts";
import { MediaObjectsService } from "../src/services/media-object-service.ts";
import { VibesService } from "../src/services/vibe-service.ts";

const databaseUrl = process.env.RHIZOME_TEST_DATABASE_URL ?? "postgres://localhost/rhizome_m1_test";
const { db, client } = createDatabase(databaseUrl, { max: 2 });
const actor: UserActor = {
  kind: "user",
  uuid: DEV_USER_UUID,
  subject: `id:rnet://id/${DEV_USER_UUID}`,
};
const service = new VibesService({ db, actor });
const old = new Date("2020-01-01T00:00:00.000Z");
const created: string[] = [];

beforeAll(async () => {
  await seedDb(db);
});
afterAll(async () => {
  for (const uuid of created) await db.delete(vibes).where(eq(vibes.uuid, uuid));
  await client.end();
});
async function createVibe() {
  const result = await service.createVibe({ title: "Recency" });
  created.push(result.vibe.uuid);
  return result;
}
async function resetTime(uuid: string) {
  await db.update(vibes).set({ updatedAt: old }).where(eq(vibes.uuid, uuid));
}
async function readTime(uuid: string) {
  return serializeVibe(await service.getVibe(uuid)).updated_at;
}

describe("Vibe update timestamps", () => {
  test("creation and reads expose the persisted column without consulting revision time", async () => {
    const aggregate = await createVibe();
    const document = serializeVibe(aggregate);
    expect(document.created_at).toBe(document.updated_at);
    expect(validateSchema("vibe", document).ok).toBe(true);
    expect(document).not.toHaveProperty("x-rhizome-updated-at");
    await resetTime(aggregate.vibe.uuid);
    await db
      .update(vibeRevisions)
      .set({ createdAt: new Date("2040-01-01T00:00:00Z") })
      .where(eq(vibeRevisions.vibeUuid, aggregate.vibe.uuid));
    expect(await readTime(aggregate.vibe.uuid)).toBe(old.toISOString());
    const listed = (await service.listVibes()).find(
      ({ vibe }) => vibe.uuid === aggregate.vibe.uuid,
    )!;
    expect(serializeVibe(listed).updated_at).toBe(old.toISOString());
    expect(await readTime(aggregate.vibe.uuid)).toBe(old.toISOString());
  });

  test("title, grant, pull config, authored additions, and membership changes advance recency", async () => {
    const { vibe } = await createVibe();
    const author = new MediaObjectsService({
      db,
      actor: {
        kind: "client",
        uuid: DEV_DMACHINE_UUID,
        name: "rbudget",
        subject: "client:rbudget",
      },
    });
    let objectUri = "";
    const changes = [
      () => service.updateVibe(vibe.uuid, { title: "Renamed" }),
      () =>
        service.updateVibe(vibe.uuid, {
          grants: [{ subject: "client:rbudget", scope: ["read", "write:objects"] }],
        }),
      () => service.updateVibe(vibe.uuid, { pull: { enabled: false } }),
      async () => {
        const [createdObject] = await author.createMediaObjects(`rnet://vibe/${vibe.uuid}`, [
          { type: "note", properties: { title: "Added" } },
        ]);
        objectUri = `rnet://object/${createdObject!.mediaObject.uuid}`;
      },
      () => service.removeMediaObjectRefs(vibe.uuid, [objectUri]),
      () => service.addMediaObjectRefs(vibe.uuid, [objectUri]),
      () => service.renameVibeIfTitle(vibe.uuid, "Renamed", "Imported"),
    ];
    for (const change of changes) {
      await resetTime(vibe.uuid);
      await change();
      expect(Date.parse(await readTime(vibe.uuid))).toBeGreaterThan(old.getTime());
    }
    await resetTime(vibe.uuid);
    await service.renameVibeIfTitle(vibe.uuid, "Renamed", "Should not apply");
    expect(await readTime(vibe.uuid)).toBe(old.toISOString());
    const ownerObjects = new MediaObjectsService({ db, actor });
    await ownerObjects.setUser(objectUri.split("/").at(-1)!, { note: "An object edit" });
    expect(await readTime(vibe.uuid)).toBe(old.toISOString());
  });

  test("inference advances recency atomically; preserved writes and rolled-back changes do not", async () => {
    const { vibe } = await createVibe();
    const operationUuid = uuidv7();
    await db.insert(operations).values({
      uuid: operationUuid,
      kind: "push",
      status: "running",
      vibeUuid: vibe.uuid,
      ownerUuid: DEV_USER_UUID,
      invokedBy: actor.subject,
      request: {},
    });
    const entry = { model: "mock/rhizome", properties: { summary: "A summary" } };
    await resetTime(vibe.uuid);
    await writeVibeTaskInferred(db, {
      vibeUuid: vibe.uuid,
      task: "summarize",
      entry,
      operationUuid,
    });
    expect(Date.parse(await readTime(vibe.uuid))).toBeGreaterThan(old.getTime());
    await db
      .update(vibes)
      .set({ updatedAt: old, inferred: { "rhizome:summarize": { ...entry, durable: true } } })
      .where(eq(vibes.uuid, vibe.uuid));
    expect(
      await writeVibeTaskInferred(db, {
        vibeUuid: vibe.uuid,
        task: "summarize",
        entry,
        operationUuid,
      }),
    ).toEqual({ outcome: "preserved_durable" });
    expect(await readTime(vibe.uuid)).toBe(old.toISOString());
    await expect(
      db.transaction(async (transaction) => {
        await transaction
          .update(vibes)
          .set({ title: "Rolled back" })
          .where(eq(vibes.uuid, vibe.uuid));
        throw new Error("abort transaction");
      }),
    ).rejects.toThrow("abort transaction");
    expect(await readTime(vibe.uuid)).toBe(old.toISOString());
  });
});
