import { SOURCE_SKILL_ID_PATTERN, sourceCredentialDocumentSchema } from "@rhizome/store-contract";

import type { CredentialedSourceCatalog } from "../../../ingest/connected-sources/types.ts";
import type { Database, ProviderLeasePool } from "../db/index.ts";
import type { SourceCredentialCrypto } from "../services/source-credential-crypto.ts";
import { Problem } from "../errors.ts";
import { schemaProblem } from "../services/problems.ts";
import {
  SourceCredentialsService,
  serializeSourceCredential,
} from "../services/source-credential-service.ts";
import { ProblemSchema, RecordIdParamsSchema, jsonSchema, jsonSchemaValue } from "./contracts.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const SourceCredentialDocumentSchema = jsonSchema(sourceCredentialDocumentSchema);
const SourceSkillParamsSchema = jsonSchema({
  type: "object",
  required: ["skill_id"],
  properties: { skill_id: { type: "string", pattern: SOURCE_SKILL_ID_PATTERN } },
  additionalProperties: false,
});
const SourceConnectionRequestSchema = jsonSchema({
  type: "object",
  additionalProperties: true,
});

export function createSourceCredentialRoutes(
  db: Database,
  catalog: CredentialedSourceCatalog,
  credentialCrypto: SourceCredentialCrypto,
  providerLeasePool: ProviderLeasePool,
) {
  const router = createRhizomeRouter();
  const connectionSchemas = new Map(
    catalog
      .all()
      .filter((skill) => skill.connection.mode === "claim_exchange")
      .map((skill) => [
        skill.skillId,
        jsonSchemaValue<Record<string, unknown>>(
          skill.connection.mode === "claim_exchange" ? skill.connection.requestSchema : {},
        ),
      ]),
  );

  router.post(
    "/:skill_id",
    {
      operationId: "connectSourceCredential",
      auth: "user",
      request: { param: SourceSkillParamsSchema, json: SourceConnectionRequestSchema },
      responses: {
        201: SourceCredentialDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
        429: ProblemSchema,
      },
    },
    async (context) => {
      const skillId = context.req.valid("param").skill_id;
      const skill = catalog.forSkillId(skillId);
      if (!skill) {
        throw new Problem(
          422,
          "parser_unsupported",
          "Source skill unsupported",
          `Source skill ${skillId} is not installed`,
        );
      }
      if (skill.connection.mode !== "claim_exchange") {
        throw new Problem(
          422,
          "schema_violation",
          "Connection mode mismatch",
          "This source must be connected through its advertised OAuth flow",
        );
      }
      const validation = connectionSchemas
        .get(skillId)!
        .validate(context.req.valid("json"), context.get("actor"));
      if (!validation.ok) throw schemaProblem(validation.issues);
      const service = new SourceCredentialsService({
        db,
        actor: context.get("actor"),
        credentialCrypto,
        credentialedSources: catalog,
        providerLeasePool,
      });
      const credential = await service.connect(skill, validation.value);
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
        credentialedSources: catalog,
        providerLeasePool,
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
        429: ProblemSchema,
      },
    },
    async (context) => {
      const service = new SourceCredentialsService({
        db,
        actor: context.get("actor"),
        credentialCrypto,
        credentialedSources: catalog,
        providerLeasePool,
      });
      await service.revoke(context.req.valid("param").id);
      return context.body(null, 204);
    },
  );

  return router;
}
