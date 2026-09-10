import { storeTaskKey } from "@rhizome/store-contract";
import { mediaObjectSchema, mediaElementSchema, vibeSchema, type MediaObject } from "@rnet/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/index.ts";
import { grants } from "../db/models/grant.ts";
import { mediaObjects } from "../db/models/media-object.ts";
import { mediaElements } from "../db/models/media-element.ts";
import { mediaObjectRevisions } from "../db/models/media-object-revision.ts";
import { mediaElementRevisions } from "../db/models/media-element-revision.ts";
import { vibeRevisions } from "../db/models/vibe-revision.ts";
import { vibes } from "../db/models/vibe.ts";
import { STORE_ACTOR } from "../rnet.ts";
import { jsonSchema } from "../routes/contracts.ts";
import { snapshotVibe } from "./vibe-snapshot.ts";

export type InferredEntry = NonNullable<MediaObject["inferred"]>[string];
export type WriteOutcome =
  | { outcome: "written"; rev: number }
  | { outcome: "removed"; rev: number }
  | { outcome: "preserved_durable" }
  | { outcome: "not_applicable" };
const objectBlock = jsonSchema(mediaObjectSchema.properties.inferred);
const elementBlock = jsonSchema(mediaElementSchema.properties.inferred);
const vibeBlock = jsonSchema(vibeSchema.properties.inferred);
interface TaskWrite {
  task: string;
  entry: InferredEntry | null;
  operationUuid: string;
}

export async function writeObjectTaskInferred(
  db: Database,
  input: TaskWrite & { mediaObjectUuid: string },
): Promise<WriteOutcome> {
  const key = storeTaskKey(input.task);
  return db
    .transaction<WriteOutcome>(async (transaction) => {
      const [locked] = await transaction
        .select()
        .from(mediaObjects)
        .where(eq(mediaObjects.uuid, input.mediaObjectUuid))
        .for("update");
      if (!locked) throw new Error("Push object disappeared");
      if (locked.inferred[key]?.durable === true) throw new NoWrite("preserved_durable");
      if (input.entry === null && !Object.hasOwn(locked.inferred, key))
        throw new NoWrite("not_applicable");
      const next = nextBlock(locked.inferred, key, input.entry);
      if (!objectBlock.validate(next).ok) throw new Error("Invalid object inferred block");
      const [updated] = await transaction
        .update(mediaObjects)
        .set({ inferred: next, inferredRev: sql`${mediaObjects.inferredRev} + 1` })
        .where(eq(mediaObjects.uuid, locked.uuid))
        .returning();
      await transaction.insert(mediaObjectRevisions).values({
        mediaObjectUuid: locked.uuid,
        block: "inferred",
        rev: updated!.inferredRev,
        snapshot: next,
        actor: STORE_ACTOR,
        operationUuid: input.operationUuid,
      });
      return { outcome: input.entry === null ? "removed" : "written", rev: updated!.inferredRev };
    })
    .catch(recoverNoWrite);
}

export async function writeElementTaskInferred(
  db: Database,
  input: TaskWrite & { mediaElementUuid: string },
): Promise<WriteOutcome> {
  const key = storeTaskKey(input.task);
  return db
    .transaction<WriteOutcome>(async (transaction) => {
      const [locked] = await transaction
        .select()
        .from(mediaElements)
        .where(eq(mediaElements.uuid, input.mediaElementUuid))
        .for("update");
      if (!locked) throw new Error("Push element disappeared");
      if (locked.inferred[key]?.durable === true) throw new NoWrite("preserved_durable");
      if (input.entry === null && !Object.hasOwn(locked.inferred, key))
        throw new NoWrite("not_applicable");
      const next = nextBlock(locked.inferred, key, input.entry);
      if (!elementBlock.validate(next).ok) throw new Error("Invalid element inferred block");
      const [updated] = await transaction
        .update(mediaElements)
        .set({ inferred: next, inferredRev: sql`${mediaElements.inferredRev} + 1` })
        .where(eq(mediaElements.uuid, locked.uuid))
        .returning();
      await transaction.insert(mediaElementRevisions).values({
        mediaElementUuid: locked.uuid,
        block: "inferred",
        rev: updated!.inferredRev,
        snapshot: next,
        actor: STORE_ACTOR,
        operationUuid: input.operationUuid,
      });
      return { outcome: input.entry === null ? "removed" : "written", rev: updated!.inferredRev };
    })
    .catch(recoverNoWrite);
}

export async function writeVibeTaskInferred(
  db: Database,
  input: Omit<TaskWrite, "entry"> & { entry: InferredEntry; vibeUuid: string },
): Promise<{ outcome: "written"; rev: number } | { outcome: "preserved_durable" }> {
  const key = storeTaskKey(input.task);
  if (input.entry === null) throw new Error("Vibe task output cannot be null");
  return db
    .transaction<{ outcome: "written"; rev: number }>(async (transaction) => {
      const [locked] = await transaction
        .select()
        .from(vibes)
        .where(eq(vibes.uuid, input.vibeUuid))
        .for("update");
      if (!locked) throw new Error("Push Vibe disappeared");
      if (locked.inferred[key]?.durable === true) throw new NoWrite("preserved_durable");
      const next = nextBlock(locked.inferred, key, input.entry);
      if (!vibeBlock.validate(next).ok) throw new Error("Invalid Vibe inferred block");
      const [updated] = await transaction
        .update(vibes)
        .set({ inferred: next, rev: sql`${vibes.rev} + 1` })
        .where(eq(vibes.uuid, locked.uuid))
        .returning();
      const activeGrants = await transaction
        .select()
        .from(grants)
        .where(and(eq(grants.vibeUuid, locked.uuid), isNull(grants.revokedAt)));
      await transaction.insert(vibeRevisions).values({
        vibeUuid: locked.uuid,
        rev: updated!.rev,
        actor: STORE_ACTOR,
        operationUuid: input.operationUuid,
        snapshot: snapshotVibe(
          updated!,
          activeGrants.map((grant) => ({ subject: grant.subject, scope: grant.scopes })),
        ),
      });
      return { outcome: "written", rev: updated!.rev };
    })
    .catch((error: unknown) => {
      if (error instanceof NoWrite && error.outcome === "preserved_durable")
        return { outcome: "preserved_durable" as const };
      throw error;
    });
}

/** Throw through the transaction so a no-write exit issues ROLLBACK and releases its lock. */
class NoWrite extends Error {
  constructor(readonly outcome: "preserved_durable" | "not_applicable") {
    super(outcome);
  }
}
function recoverNoWrite(error: unknown): WriteOutcome {
  if (error instanceof NoWrite) return { outcome: error.outcome };
  throw error;
}

function nextBlock(
  current: Record<string, InferredEntry>,
  key: string,
  entry: InferredEntry | null,
) {
  const next = { ...current };
  if (entry === null) delete next[key];
  else {
    if (Object.hasOwn(entry, "durable")) throw new Error("Push never writes durable entries");
    next[key] = entry;
  }
  return next;
}
