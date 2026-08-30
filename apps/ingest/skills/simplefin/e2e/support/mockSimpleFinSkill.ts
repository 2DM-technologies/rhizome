import accountsCurrentFixture from "../../fixtures/accounts-current-v2.json";
import providerErrorsFixture from "../../fixtures/provider-errors-v2.json";
import { filterSimpleFinTransactions, createSimpleFinSkill } from "../../source.ts";
import { simpleFinParser } from "../../scripts/parse-simplefin.ts";
import { stageMockTransactions } from "../../../../../host/e2e/support/mockTransactionSkill.ts";
import type {
  MockSourceSkillAdapter,
  MockStagedImport,
} from "../../../../../host/e2e/support/mockStore.ts";

export const SIMPLEFIN_CREDENTIAL_ID = "0198f2a1-0601-7e01-8e01-000000000001";
export const SIMPLEFIN_IMPORT_SOURCE_ID = "0198f2a1-0701-7f01-8f01-000000000001";
export const SIMPLEFIN_IMPORT_OPERATION_ID = "0198f2a1-0801-7001-9001-000000000001";
export const COMPROMISED_SIMPLEFIN_TOKEN = "compromised-simplefin-setup-token";

const manifest = createSimpleFinSkill({
  allowedHosts: ["bridge.simplefin.test"],
}).manifest;

export const mockSimpleFinSourceSkill = createMockSimpleFinSourceSkill(accountsCurrentFixture);

/** Provider-error behavior uses the skill's existing redaction fixture, never an inline response. */
export const mockSimpleFinProviderErrorSourceSkill =
  createMockSimpleFinSourceSkill(providerErrorsFixture);

function createMockSimpleFinSourceSkill(captureFixture: unknown): MockSourceSkillAdapter {
  return {
    credentialId: SIMPLEFIN_CREDENTIAL_ID,
    manifest,
    operationId: SIMPLEFIN_IMPORT_OPERATION_ID,
    sourceId: SIMPLEFIN_IMPORT_SOURCE_ID,
    sourceAction: {
      title: "SimpleFIN history needs a new baseline",
      detail:
        "The previous connected balance cannot be reconciled inside SimpleFIN's history window.",
      operationError:
        "The connected account balances cannot be reconciled with the returned transaction history.",
    },
    capture(context) {
      const sequence = context.nextSequence(manifest.skill_id);
      return context.save({
        id: `0198f2a1-0901-7101-a001-${String(sequence).padStart(12, "0")}`,
        payload: JSON.stringify(captureFixture),
        contentHash: `sha256:${String(sequence).padStart(64, "e")}`,
        label: "SimpleFIN accounts response",
        mime: "application/json",
      });
    },
    connect(input) {
      if (!isRecord(input) || typeof input.setup_token !== "string" || !input.setup_token) {
        return { ok: false, detail: "SimpleFIN setup token is required" };
      }
      return input.setup_token === COMPROMISED_SIMPLEFIN_TOKEN
        ? {
            ok: false,
            detail:
              "SimpleFIN rejected this setup token. It may be compromised; disable it in SimpleFIN Bridge and create a new one.",
          }
        : { ok: true };
    },
    normalizeConfig(input) {
      return input === undefined || isRecord(input)
        ? { ok: true, value: input ?? {} }
        : { ok: false, detail: "SimpleFIN source configuration must be an object" };
    },
    stage({ actionResumed, origin }): Promise<MockStagedImport> {
      return stageMockTransactions({
        idNamespace: SIMPLEFIN_IMPORT_OPERATION_ID,
        manifest,
        normalize: (parsed) => filterSimpleFinTransactions(parsed, {}),
        origin,
        parser: simpleFinParser,
        ...(actionResumed
          ? {
              verifyOptions: {
                historyRecovery: {
                  mode: "rebaseline",
                  reason: "source_action_required",
                  previous_balance_at: "2026-04-01T00:00:00.000Z",
                  history_resumes_at: "2026-08-01T00:00:00.000Z",
                },
              },
            }
          : {}),
      });
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
