import type {
  PublicRemoteSourceSkill,
  PublicSourceCandidateDraft,
  PublicSourceJsonObject,
  PublicSourceJsonValue,
  PublicSourceVerifyReport,
} from "../../public-sources/types.ts";

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
    verify(parsed, config) {
      const channel = parsedChannel(parsed);
      const normalized = parseConfig(config);
      const report = verifyArena(channel);
      const locatorMatches = channel.channelUrl === normalized.url;
      return {
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
      } satisfies PublicSourceVerifyReport;
    },
    candidates(parsed, config) {
      const channel = parsedChannel(parsed);
      const normalized = parseConfig(config);
      if (channel.channelUrl !== normalized.url) {
        throw new Error("Are.na capture does not match the configured source");
      }
      return channel.blocks.map((block): PublicSourceCandidateDraft => ({
        type: "arena.block",
        keys: block.keys,
        sourceProperties: publicJsonObject(block.sourceProperties, `Are.na block ${block.blockId}`),
        retrievedAt: channel.retrievedAt,
        elements: block.elements.map((element) => ({
          role: element.role,
          kind: element.kind,
          mime: element.mime,
          bytes: element.bytes,
          byteSize: element.byteSize,
          contentHash: element.contentHash,
        })),
      }));
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

function publicJsonObject(value: unknown, label: string): PublicSourceJsonObject {
  const converted = publicJsonValue(value, new Set(), label);
  if (!converted || typeof converted !== "object" || Array.isArray(converted)) {
    throw new Error(`${label} source properties are not an object`);
  }
  return converted as PublicSourceJsonObject;
}

function publicJsonValue(
  value: unknown,
  ancestors: Set<object>,
  label: string,
): PublicSourceJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") throw new Error(`${label} is not JSON-safe`);
  if (ancestors.has(value)) throw new Error(`${label} contains a cycle`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => publicJsonValue(entry, ancestors, label));
    }
    const result: PublicSourceJsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) throw new Error(`${label}.${key} is undefined`);
      result[key] = publicJsonValue(entry, ancestors, `${label}.${key}`);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
