import { sql } from "drizzle-orm";
import { check, index, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { machines } from "./machine.ts";
import { mediaObjects } from "./media-object.ts";
import { originArtifacts } from "./origin-artifact.ts";

export const mediaObjectOrigins = pgTable(
  "object_origins",
  {
    mediaObjectUuid: uuid("object_uuid").notNull().references(() => mediaObjects.uuid, { onDelete: "cascade" }),
    originArtifactUuid: uuid("artifact_uuid").references(() => originArtifacts.uuid),
    machineUuid: uuid("machine_uuid").references(() => machines.uuid),
  },
  (mediaObjectOrigin) => [
    check(
      "object_origins_exactly_one_check",
      sql`num_nonnulls(${mediaObjectOrigin.originArtifactUuid}, ${mediaObjectOrigin.machineUuid}) = 1`,
    ),
    uniqueIndex("object_origins_artifact_unique_idx")
      .on(mediaObjectOrigin.mediaObjectUuid, mediaObjectOrigin.originArtifactUuid)
      .where(sql`${mediaObjectOrigin.machineUuid} IS NULL`),
    uniqueIndex("object_origins_machine_unique_idx")
      .on(mediaObjectOrigin.mediaObjectUuid, mediaObjectOrigin.machineUuid)
      .where(sql`${mediaObjectOrigin.originArtifactUuid} IS NULL`),
    index("object_origins_object_idx").on(mediaObjectOrigin.mediaObjectUuid),
  ],
);
