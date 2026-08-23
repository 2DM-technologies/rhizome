import { integer, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";

import { mediaElements } from "./media-element.ts";
import { mediaObjects } from "./media-object.ts";

export const mediaObjectElements = pgTable(
  "object_elements",
  {
    mediaObjectUuid: uuid("object_uuid").notNull().references(() => mediaObjects.uuid, { onDelete: "cascade" }),
    mediaElementUuid: uuid("element_uuid").notNull().references(() => mediaElements.uuid),
    position: integer("position").notNull(),
  },
  (mediaObjectElement) => [
    primaryKey({ columns: [mediaObjectElement.mediaObjectUuid, mediaObjectElement.position] }),
  ],
);
