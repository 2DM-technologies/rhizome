import {
  connectSimpleFinRequestSchema,
  sourceCredentialDocumentSchema,
} from "@rhizome/store-contract";

import type { Database } from "../db/index.ts";
import type { SourceCredentialCrypto } from "../services/source-credential-crypto.ts";
import {
  SourceCredentialsService,
  serializeSourceCredential,
  type SimpleFinTokenExchange,
} from "../services/source-credential-service.ts";
import { ProblemSchema, RecordIdParamsSchema, jsonSchema } from "./contracts.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const ConnectSimpleFinRequestSchema = jsonSchema(connectSimpleFinRequestSchema);
const SourceCredentialDocumentSchema = jsonSchema(sourceCredentialDocumentSchema);

export function createSourceCredentialRoutes(
  db: Database,
  simpleFin: SimpleFinTokenExchange,
  credentialCrypto: SourceCredentialCrypto,
) {
  const router = createRhizomeRouter();

  router.post(
    "/simplefin",
    {
      operationId: "connectSimpleFin",
      auth: "user",
      request: { json: ConnectSimpleFinRequestSchema },
      responses: {
        201: SourceCredentialDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
        429: ProblemSchema,
      },
    },
    async (context) => {
      const service = new SourceCredentialsService({
        db,
        actor: context.get("actor"),
        credentialCrypto,
        simpleFin,
      });
      const credential = await service.connectSimpleFin(context.req.valid("json"));
      return context.json(serializeSourceCredential(credential), 201);
    },
  );

  router.get(
    "/:id",
    {
      operationId: "getSourceCredential",
      auth: "user",
      request: { param: RecordIdParamsSchema },
      responses: {
        200: SourceCredentialDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const service = new SourceCredentialsService({
        db,
        actor: context.get("actor"),
        credentialCrypto,
        simpleFin,
      });
      const credential = await service.getOwned(context.req.valid("param").id);
      return context.json(serializeSourceCredential(credential));
    },
  );

  router.delete(
    "/:id",
    {
      operationId: "revokeSourceCredential",
      auth: "user",
      request: { param: RecordIdParamsSchema },
      responses: {
        204: null,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const service = new SourceCredentialsService({
        db,
        actor: context.get("actor"),
        credentialCrypto,
        simpleFin,
      });
      await service.revoke(context.req.valid("param").id);
      return context.body(null, 204);
    },
  );

  return router;
}
