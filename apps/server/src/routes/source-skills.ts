import { sourceSkillManifestsResponseSchema } from "@rhizome/store-contract";

import type { SourceSkillManifestCatalog } from "../../../ingest/source-skills/manifest-catalog.ts";
import { jsonSchema } from "./contracts.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const SourceSkillManifestsResponseSchema = jsonSchema(sourceSkillManifestsResponseSchema);

/** Publishes data-only UI capabilities; executable behavior stays in the registered catalog. */
export function createSourceSkillRoutes(catalog: SourceSkillManifestCatalog) {
  const router = createRhizomeRouter();

  router.get(
    "/",
    {
      operationId: "listSourceSkills",
      auth: "user",
      responses: { 200: SourceSkillManifestsResponseSchema },
    },
    (context) => context.json({ skills: catalog.all() }),
  );

  return router;
}
