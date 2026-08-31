import type { PublicRemoteSourceSkill } from "../../public-sources/types.ts";
import {
  CANDIDATE_BUNDLE_CAPABILITY,
  candidateBundle,
  type SourceCandidateDraft,
  type SourceJsonObject,
  type SourceJsonValue,
} from "../../source-skills/candidate-bundle.ts";

import { ARENA_API_ORIGIN, ArenaClient, type ArenaClientOptions } from "./client.ts";
import {
  ARENA_SKILL_ID,
  arenaSourceConfigSchema,
  normalizeArenaChannelLocator,
  parseArenaSourceConfig,
  type ArenaSourceConfig,
} from "./contracts.ts";
import { arenaSourceSkillManifest } from "./manifest.ts";
import { arenaParser, type ParsedArenaChannel } from "./scripts/parse-arena.ts";
import { verifyArena } from "./verify.ts";

export interface ArenaSourceSkillDependencies extends ArenaClientOptions {}

export function createArenaSourceSkill(
  dependencies: ArenaSourceSkillDependencies,
): PublicRemoteSourceSkill {
  const client = new ArenaClient(dependencies);
  return {
    skillId: ARENA_SKILL_ID,
    displayName: arenaSourceSkillManifest.label,
    manifest: arenaSourceSkillManifest,
    parser: arenaParser,
    compiledSource: {
      kind: CANDIDATE_BUNDLE_CAPABILITY,
      async compile({ bytes, config }) {
        const channel = parsedChannel(await arenaParser.parse(bytes));
        const normalized = parseConfig(config);
        const report = verifyArena(channel);
        const locatorMatches = channel.channelUrl === normalized.url;
        const verify = {
          ...report,
          ok: report.ok && locatorMatches,
          checks: [
            ...report.checks,
            {
              name: "source_locator",
              ok: locatorMatches,
              detail: locatorMatches
                ? "The capture matches the configured Are.na channel URL"
                : "The capture does not match the configured Are.na channel URL",
            },
          ],
        };
        const candidates = channel.blocks.map((block): SourceCandidateDraft => ({
          type: "arena.block",
          keys: block.keys,
          sourceProperties: sourceJsonObject(
            block.sourceProperties,
            `Are.na block ${block.blockId}`,
          ),
          retrievedAt: channel.retrievedAt,
          elements: block.elements.map((element) => ({
            role: element.role,
            ...(element.alt ? { alt: element.alt } : {}),
            kind: element.kind,
            mime: element.mime,
            bytes: element.bytes,
            byteSize: element.byteSize,
            contentHash: element.contentHash,
          })),
          semanticIdentity: { type: "arena.block", keys: block.keys },
        }));
        return candidateBundle(candidates, verify);
      },
    },
    sourceRequestSchema: arenaSourceConfigSchema,
    fetchPolicy: { attempts: 24, windowHours: 24 },
    networkPolicy: {
      capabilities: [
        { kind: "fixed_https_origins", origins: [ARENA_API_ORIGIN] },
        { kind: "safe_public_https" },
      ],
    },
    capture: {
      mime: "application/vnd.rhizome.arena-capture+json",
      label(config, fetchUuid) {
        const { channelSlug } = normalizeArenaChannelLocator(parseConfig(config).url);
        return `arena-${channelSlug}-${fetchUuid}.json`;
      },
    },
    normalizeConfig(input) {
      const config = parseArenaSourceConfig(input);
      return { url: config.url };
    },
    parseConfig,
    stateDigest(config) {
      return {
        version: "arena-source-state@1",
        url: parseConfig(config).url,
      };
    },
    retrieve(config) {
      return client.fetchChannelCapture(parseConfig(config));
    },
  } satisfies PublicRemoteSourceSkill;
}

function parseConfig(value: unknown): ArenaSourceConfig {
  return parseArenaSourceConfig(value);
}

function parsedChannel(value: unknown): ParsedArenaChannel {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray((value as Partial<ParsedArenaChannel>).blocks) ||
    typeof (value as Partial<ParsedArenaChannel>).channelId !== "string" ||
    typeof (value as Partial<ParsedArenaChannel>).channelUrl !== "string"
  ) {
    throw new Error("Are.na parser output is invalid");
  }
  return value as ParsedArenaChannel;
}

function sourceJsonObject(value: unknown, label: string): SourceJsonObject {
  const converted = sourceJsonValue(value, new Set(), label);
  if (!converted || typeof converted !== "object" || Array.isArray(converted)) {
    throw new Error(`${label} source properties are not an object`);
  }
  return converted as SourceJsonObject;
}

function sourceJsonValue(value: unknown, ancestors: Set<object>, label: string): SourceJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") throw new Error(`${label} is not JSON-safe`);
  if (ancestors.has(value)) throw new Error(`${label} contains a cycle`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sourceJsonValue(entry, ancestors, label));
    }
    const result: SourceJsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) throw new Error(`${label}.${key} is undefined`);
      result[key] = sourceJsonValue(entry, ancestors, `${label}.${key}`);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
