import type { MediaObjectElementRef } from "@rnet/types";
import { check, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

import { mediaElements } from "./media-element.ts";
import { mediaObjects } from "./media-object.ts";
import { textEnumCheck } from "./shared.ts";

export const MediaObjectElementRoleEnum = [
  "title",
  "content",
  "preview",
] as const satisfies readonly NonNullable<MediaObjectElementRef["role"]>[];
export type MediaObjectElementRole = (typeof MediaObjectElementRoleEnum)[number];

export const mediaObjectElements = pgTable(
  "media_object_elements",
  {
    mediaObjectUuid: uuid("media_object_uuid")
      .notNull()
      .references(() => mediaObjects.uuid, { onDelete: "cascade" }),
    mediaElementUuid: uuid("media_element_uuid")
      .notNull()
      .references(() => mediaElements.uuid),
    position: integer("position").notNull(),
    role: text("role", { enum: MediaObjectElementRoleEnum }),
  },
  (mediaObjectElement) => [
    primaryKey({ columns: [mediaObjectElement.mediaObjectUuid, mediaObjectElement.position] }),
    check(
      "media_object_elements_role_check",
      textEnumCheck(mediaObjectElement.role, MediaObjectElementRoleEnum),
    ),
  ],
);

export type DbMediaObjectElement = typeof mediaObjectElements.$inferSelect;
export type NewDbMediaObjectElement = typeof mediaObjectElements.$inferInsert;
