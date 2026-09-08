import type {
  CredentialedSourceSkill,
  SourceSkillDefinition,
} from "../../../connected-sources/types.ts";
import { defineXCandidateBundle } from "../definition.ts";
import { captureXOAuthTimeline } from "./capture.ts";
import { XApiClient } from "./client.ts";
import { isXOAuthConfigured, loadXOAuthSettings, type XOAuthSettings } from "./config.ts";
import { xOAuthSourceManifest } from "./manifest.ts";
import { createXOAuthConnection, type XOAuthConnectionOptions } from "./oauth.ts";
import {
  X_OAUTH_CAPTURE_MIME,
  parseXOAuthCapture,
  planXOAuthTimelineRequest,
  xOAuthParser,
} from "./parser.ts";

const FETCH_ATTEMPTS = 24;
const FETCH_WINDOW_HOURS = 24;

export const xOAuthSourceConfigSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  additionalProperties: false,
} as const);

export type XOAuthSkillOptions = XOAuthConnectionOptions;

export function createXOAuthSkill(
  settings: XOAuthSettings,
  options: XOAuthSkillOptions = {},
): CredentialedSourceSkill {
  const client = options.client ?? new XApiClient(options);
  const connection = createXOAuthConnection(settings, { ...options, client });
  return {
    skillId: xOAuthSourceManifest.skill_id,
    displayName: xOAuthSourceManifest.label,
    availability: settings.budgetEnabled ? "active" : "lifecycle_only",
    manifest: xOAuthSourceManifest,
    parser: xOAuthParser,
    sourceRequestSchema: xOAuthSourceConfigSchema,
    connection,
    fetchPolicy: { attempts: FETCH_ATTEMPTS, windowHours: FETCH_WINDOW_HOURS },
    capture: {
      mime: X_OAUTH_CAPTURE_MIME,
      label: (fetchUuid) => `x-oauth-${fetchUuid}.zip`,
    },
    parseConfig: parseXOAuthSourceConfig,
    async prepareFetch({ config, limits, previousCapture, resume }) {
      if (!settings.budgetEnabled) {
        throw new Error("X OAuth capture is disabled by operator budget policy");
      }
      parseXOAuthSourceConfig(config);
      if (resume !== undefined) {
        throw new Error("X OAuth does not accept a source continuation");
      }
      const request = await planXOAuthTimelineRequest(previousCapture, limits);
      return {
        retrieve(secret, { signal }) {
          return captureXOAuthTimeline({
            client,
            secret,
            limits,
            signal,
            request,
            ...(options.now ? { now: options.now } : {}),
          });
        },
        compiledSource: defineXCandidateBundle(async ({ bytes, limits }) => {
          const capture = await parseXOAuthCapture(bytes, limits);
          return capture.selection;
        }),
      };
    },
  };
}

export const xOAuthSourceSkillDefinition = {
  skillId: xOAuthSourceManifest.skill_id,
  parser: xOAuthParser,
  loadSettings: loadXOAuthSettings,
  isConfigured: isXOAuthConfigured,
  create(settings: XOAuthSettings | undefined) {
    if (!settings) throw new Error("X OAuth source is not configured");
    return createXOAuthSkill(settings);
  },
} satisfies SourceSkillDefinition<XOAuthSettings | undefined>;

function parseXOAuthSourceConfig(value: unknown): Readonly<Record<string, never>> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.keys(value).length > 0
  ) {
    throw new Error("Stored X OAuth source configuration is invalid");
  }
  return Object.freeze({});
}
