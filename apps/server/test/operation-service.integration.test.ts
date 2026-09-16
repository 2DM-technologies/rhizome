import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { DEV_DMACHINE_UUID, DEV_USER_UUID, type Actor } from "../src/auth.ts";
import { createDatabase } from "../src/db/index.ts";
import { operations } from "../src/db/models/operation.ts";
import { vibes } from "../src/db/models/vibe.ts";
import { seedDb } from "../src/db/seedDb.ts";
import { RNET_SCHEMA_VERSION } from "../src/rnet.ts";
import { AccessService } from "../src/services/access-service.ts";
import { OperationsService } from "../src/services/operation-service.ts";

const { db, client } = createDatabase(
  process.env.RHIZOME_TEST_DATABASE_URL ?? "postgres://localhost/rhizome_m1_test",
);
const owner: Actor = {
  kind: "user",
  uuid: DEV_USER_UUID,
  subject: `id:rnet://id/${DEV_USER_UUID}`,
};
const invoker: Actor = {
  kind: "client",
  uuid: DEV_DMACHINE_UUID,
  name: "rbudget",
  subject: "client:rbudget",
};

beforeAll(async () => {
  await client.unsafe("TRUNCATE TABLE users CASCADE");
  await seedDb(db);
});
afterAll(() => client.end());

async function fixture() {
  const vibeUuid = uuidv7();
  const operationUuid = uuidv7();
  await db.insert(vibes).values({
    uuid: vibeUuid,
    title: "Operation deletion race",
    ownerUuid: DEV_USER_UUID,
    rnetSchema: RNET_SCHEMA_VERSION,
  });
  await db.insert(operations).values({
    uuid: operationUuid,
    kind: "push",
    status: "running",
    ownerUuid: DEV_USER_UUID,
    invokedBy: invoker.subject,
    vibeUuid,
    request: { mode: "push" },
  });
  return { vibeUuid, operationUuid };
}

test("deletion between operation and scope reads retains only the push owner's access", async () => {
  const assertScope = AccessService.prototype.assertVibeScope;
  for (const actor of [owner, invoker, { kind: "public", subject: "public" } as const]) {
    const { vibeUuid, operationUuid } = await fixture();
    const gate = spyOn(AccessService.prototype, "assertVibeScope").mockImplementation(
      async function (this: AccessService, uuid, scope) {
        await db.delete(vibes).where(eq(vibes.uuid, vibeUuid));
        return assertScope.call(this, uuid, scope);
      },
    );
    try {
      const result = new OperationsService({ db, actor }).getOperation(operationUuid);
      if (actor.kind === "public") {
        await expect(result).rejects.toMatchObject({ status: 401 });
      } else if (actor.kind === "client") {
        await expect(result).rejects.toMatchObject({ status: 403 });
      } else {
        expect(await result).toMatchObject({
          exposeOwnerOnlyResult: actor.kind === "user",
          operation: { uuid: operationUuid, vibeUuid: null },
        });
      }
      await expect(
        new OperationsService({
          db,
          actor: { ...invoker, subject: "client:unrelated" },
        }).getOperation(operationUuid),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      gate.mockRestore();
    }
  }
});

test("a scope denial after Vibe deletion rechecks the owner rules", async () => {
  const { vibeUuid, operationUuid } = await fixture();
  const gate = spyOn(AccessService.prototype, "assertVibeScope").mockImplementation(async () => {
    await db.delete(vibes).where(eq(vibes.uuid, vibeUuid));
    const { grantMissing } = await import("../src/errors.ts");
    throw grantMissing("read");
  });
  try {
    expect(
      await new OperationsService({ db, actor: owner }).getOperation(operationUuid),
    ).toMatchObject({ exposeOwnerOnlyResult: true, operation: { vibeUuid: null } });
    await expect(
      new OperationsService({ db, actor: invoker }).getOperation(operationUuid),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    gate.mockRestore();
  }
});

test("an invoker still needs a grant while its Vibe exists", async () => {
  const { operationUuid } = await fixture();
  await expect(
    new OperationsService({ db, actor: invoker }).getOperation(operationUuid),
  ).rejects.toMatchObject({ status: 403 });
});
