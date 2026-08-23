import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Grant, MediaObject, Vibe } from "@rnet/types";

type JsonObject = Record<string, unknown>;

export const users = pgTable("users", {
  uuid: uuid("uuid").primaryKey(),
  name: text("name"),
  handle: text("handle").notNull().unique(),
  inferred: jsonb("inferred").$type<JsonObject>().notNull().default({}),
  avatarHash: text("avatar_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const machines = pgTable(
  "machines",
  {
    uuid: uuid("uuid").primaryKey(),
    name: text("name").notNull(),
    ownerUuid: uuid("owner_uuid").references(() => users.uuid),
    trust: text("trust").notNull().default("standard"),
    generated: boolean("generated").notNull().default(false),
    codeHash: text("code_hash").notNull(),
    manifest: jsonb("manifest").$type<JsonObject>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("machines_name_idx").on(table.name),
    check("machines_trust_check", sql`${table.trust} IN ('system', 'standard')`),
  ],
);

export const origins = pgTable(
  "origins",
  {
    uuid: uuid("uuid").primaryKey(),
    ownerUuid: uuid("owner_uuid").notNull().references(() => users.uuid),
    contentHash: text("content_hash").notNull(),
    mime: text("mime").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    label: text("label"),
    rnetSchema: text("rnet_schema").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
  },
  (table) => [index("origins_content_hash_idx").on(table.contentHash)],
);

export const elements = pgTable(
  "elements",
  {
    uuid: uuid("uuid").primaryKey(),
    ownerUuid: uuid("owner_uuid").notNull().references(() => users.uuid),
    contentHash: text("content_hash").notNull(),
    kind: text("kind").notNull(),
    mime: text("mime").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    rnetSchema: text("rnet_schema").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    createdForVibe: uuid("created_for_vibe").references(() => vibes.uuid, { onDelete: "set null" }),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
  },
  (table) => [
    check("elements_kind_check", sql`${table.kind} IN ('text', 'image', 'audio', 'video', 'document')`),
    index("elements_content_hash_idx").on(table.contentHash),
  ],
);

export const objects = pgTable(
  "objects",
  {
    uuid: uuid("uuid").primaryKey(),
    ownerUuid: uuid("owner_uuid").notNull().references(() => users.uuid),
    createdBy: text("created_by").notNull(),
    createdForVibe: uuid("created_for_vibe").references(() => vibes.uuid, { onDelete: "set null" }),
    type: text("type").notNull(),
    keys: jsonb("keys").$type<Record<string, string>>().notNull().default({}),
    source: jsonb("source").$type<MediaObject["source"]>().notNull(),
    sourceRev: integer("source_rev").notNull().default(1),
    user: jsonb("user").$type<MediaObject["user"]>(),
    userRev: integer("user_rev").notNull().default(0),
    inferred: jsonb("inferred").$type<NonNullable<MediaObject["inferred"]>>().notNull().default({}),
    extensions: jsonb("extensions").$type<JsonObject>().notNull().default({}),
    rnetSchema: text("rnet_schema").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("objects_type_idx").on(table.type),
    index("objects_keys_idx").using("gin", table.keys),
    index("objects_inferred_idx").using("gin", table.inferred),
  ],
);

export const objectElements = pgTable(
  "object_elements",
  {
    objectUuid: uuid("object_uuid").notNull().references(() => objects.uuid, { onDelete: "cascade" }),
    elementUuid: uuid("element_uuid").notNull().references(() => elements.uuid),
    position: integer("position").notNull(),
  },
  (table) => [primaryKey({ columns: [table.objectUuid, table.position] })],
);

export const objectOrigins = pgTable(
  "object_origins",
  {
    objectUuid: uuid("object_uuid").notNull().references(() => objects.uuid, { onDelete: "cascade" }),
    artifactUuid: uuid("artifact_uuid").references(() => origins.uuid),
    machineUuid: uuid("machine_uuid").references(() => machines.uuid),
  },
  (table) => [
    check(
      "object_origins_exactly_one_check",
      sql`num_nonnulls(${table.artifactUuid}, ${table.machineUuid}) = 1`,
    ),
    uniqueIndex("object_origins_artifact_unique_idx")
      .on(table.objectUuid, table.artifactUuid)
      .where(sql`${table.machineUuid} IS NULL`),
    uniqueIndex("object_origins_machine_unique_idx")
      .on(table.objectUuid, table.machineUuid)
      .where(sql`${table.artifactUuid} IS NULL`),
    index("object_origins_object_idx").on(table.objectUuid),
  ],
);

export const vibes = pgTable("vibes", {
  uuid: uuid("uuid").primaryKey(),
  title: text("title").notNull(),
  ownerUuid: uuid("owner_uuid").notNull().references(() => users.uuid),
  rnetSchema: text("rnet_schema").notNull(),
  inferred: jsonb("inferred").$type<NonNullable<Vibe["inferred"]>>().notNull().default({}),
  pullConfig: jsonb("pull_config").$type<Vibe["pull"]>(),
  extensions: jsonb("extensions").$type<JsonObject>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  rev: integer("rev").notNull().default(1),
});

export const vibeObjects = pgTable(
  "vibe_objects",
  {
    vibeUuid: uuid("vibe_uuid").notNull().references(() => vibes.uuid, { onDelete: "cascade" }),
    objectUuid: uuid("object_uuid").notNull().references(() => objects.uuid),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.vibeUuid, table.objectUuid] }),
    uniqueIndex("vibe_objects_position_idx").on(table.vibeUuid, table.position),
    check("vibe_objects_position_check", sql`${table.position} >= 0`),
  ],
);

export const grants = pgTable(
  "grants",
  {
    vibeUuid: uuid("vibe_uuid").notNull().references(() => vibes.uuid, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    scopes: jsonb("scopes").$type<Grant["scope"]>().notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.vibeUuid, table.subject] })],
);

export const operations = pgTable(
  "operations",
  {
    uuid: uuid("uuid").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    invokedBy: text("invoked_by").notNull(),
    vibeUuid: uuid("vibe_uuid").references(() => vibes.uuid),
    request: jsonb("request").$type<JsonObject>().notNull(),
    result: jsonb("result").$type<JsonObject>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    check("operations_kind_check", sql`${table.kind} IN ('push', 'pull', 'agent')`),
    check(
      "operations_status_check",
      sql`${table.status} IN ('queued', 'running', 'done', 'failed', 'aborted')`,
    ),
    index("operations_status_idx").on(table.status),
    index("operations_invoked_by_idx").on(table.invokedBy),
  ],
);

export const objectRevisions = pgTable(
  "object_revisions",
  {
    objectUuid: uuid("object_uuid").notNull().references(() => objects.uuid, { onDelete: "cascade" }),
    block: text("block").notNull(),
    rev: integer("rev").notNull(),
    snapshot: jsonb("snapshot").$type<JsonObject | null>(),
    actor: text("actor").notNull(),
    operationUuid: uuid("operation_uuid").references(() => operations.uuid),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.objectUuid, table.block, table.rev] }),
    check("object_revisions_block_check", sql`${table.block} IN ('source', 'user', 'inferred')`),
  ],
);

export const vibeRevisions = pgTable(
  "vibe_revisions",
  {
    vibeUuid: uuid("vibe_uuid").notNull().references(() => vibes.uuid, { onDelete: "cascade" }),
    rev: integer("rev").notNull(),
    snapshot: jsonb("snapshot").$type<JsonObject>().notNull(),
    membershipDelta: jsonb("membership_delta").$type<{ added: string[]; removed: string[] }>(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.vibeUuid, table.rev] })],
);

export const meter = pgTable("meter", {
  operationUuid: uuid("operation_uuid").primaryKey().references(() => operations.uuid),
  payer: text("payer").notNull(),
  model: text("model"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  turns: integer("turns"),
  durationMs: integer("duration_ms"),
  usd: numeric("usd", { precision: 12, scale: 6 }).notNull().default("0"),
  abortReason: text("abort_reason"),
  breakdown: jsonb("breakdown").$type<JsonObject>(),
});
