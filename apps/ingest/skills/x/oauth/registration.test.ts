import { describe, expect, test } from "bun:test";

import {
  createCredentialedSourceCatalog,
  loadCredentialedSourceSettings,
} from "../../../src/credentialed-source-catalog.ts";
import { X_OAUTH_BUDGET_ENABLED_ENV, X_OAUTH_CLIENT_ID_ENV } from "./config.ts";
import { xOAuthSourceManifest } from "./manifest.ts";

describe("X OAuth registration", () => {
  test("publishes the source only with operator configuration and budget consent", () => {
    const disabled = createCredentialedSourceCatalog(loadCredentialedSourceSettings({}));
    expect(disabled.forSkillId(xOAuthSourceManifest.skill_id)).toBeUndefined();
    expect(disabled.forInstalledSkillId(xOAuthSourceManifest.skill_id)).toBeUndefined();

    const lifecycleOnly = createCredentialedSourceCatalog(
      loadCredentialedSourceSettings({
        [X_OAUTH_CLIENT_ID_ENV]: "configured-client",
      }),
    );
    expect(lifecycleOnly.forSkillId(xOAuthSourceManifest.skill_id)).toBeUndefined();
    expect(lifecycleOnly.manifests()).not.toContainEqual(xOAuthSourceManifest);
    expect(lifecycleOnly.forInstalledSkillId(xOAuthSourceManifest.skill_id)).toMatchObject({
      availability: "lifecycle_only",
      connection: { mode: "oauth2", pkce: "S256", revoke: expect.any(Function) },
    });

    const enabled = createCredentialedSourceCatalog(
      loadCredentialedSourceSettings({
        [X_OAUTH_BUDGET_ENABLED_ENV]: "true",
        [X_OAUTH_CLIENT_ID_ENV]: "configured-client",
      }),
    );
    expect(enabled.forSkillId(xOAuthSourceManifest.skill_id)?.manifest).toEqual(
      xOAuthSourceManifest,
    );
    expect(enabled.forInstalledSkillId(xOAuthSourceManifest.skill_id)).toBe(
      enabled.forSkillId(xOAuthSourceManifest.skill_id),
    );
  });
});
