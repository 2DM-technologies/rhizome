import {
  createIngestionSourceRequestSchema,
  ingestionSourceDocumentSchema,
} from "@rhizome/store-contract";

import type { CredentialedSourceCatalog } from "../../../ingest/connected-sources/types.ts";
import type { FileSourceCatalog } from "../../../ingest/file-sources/types.ts";
import type { Database } from "../db/index.ts";
import {
  IngestionSourcesService,
  serializeIngestionSource,
} from "../services/ingestion-source-service.ts";
import { ProblemSchema, jsonSchema } from "./contracts.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const CreateIngestionSourceRequestSchema = jsonSchema(createIngestionSourceRequestSchema);
const IngestionSourceDocumentSchema = jsonSchema(ingestionSourceDocumentSchema);

export function createIngestionSourceRoutes(
  db: Database,
  fileSources: FileSourceCatalog,
  credentialedSources: CredentialedSourceCatalog,
) {
  const router = createRhizomeRouter();
  router.post(
    "/",
    {
      operationId: "createIngestionSource",
      auth: "user",
      request: { json: CreateIngestionSourceRequestSchema },
      responses: {
        201: IngestionSourceDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const service = new IngestionSourcesService({
        db,
        actor: context.get("actor"),
        fileSources,
        credentialedSources,
      });
      const source = await service.create(context.req.valid("json"));
      return context.json(serializeIngestionSource(source), 201);
    },
  );
  return router;
}
