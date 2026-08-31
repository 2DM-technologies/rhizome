import type { SourceSkillManifest } from "../../../packages/store-contract/src/source-skills.ts";

import { SourceSkillManifestCatalog } from "../connected-sources/types.ts";

export type PublicSourceJsonValue =
  | boolean
  | number
  | string
  | null
  | PublicSourceJsonValue[]
  | { [key: string]: PublicSourceJsonValue };

export type PublicSourceJsonObject = { [key: string]: PublicSourceJsonValue };

export type PublicSourceElementKind = "text" | "image" | "audio" | "video" | "document";
export type PublicSourceElementRole = "title" | "content" | "preview";

export interface PublicAssetFetchRequest {
  readonly url: string;
  readonly accept: string;
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly maxRedirects: number;
}

export interface PublicAssetRedirect {
  readonly status: number;
  readonly from_url: string;
  readonly location: string;
  readonly to_url: string;
}

export interface PublicAssetFetchResult {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly redirects: readonly PublicAssetRedirect[];
}

/** Server-owned adapter shared by skills that dereference provider-supplied public assets. */
export type PublicAssetFetcher = (
  request: PublicAssetFetchRequest,
) => Promise<PublicAssetFetchResult>;

export interface PublicSourceElementDraft {
  readonly role: PublicSourceElementRole;
  readonly kind: PublicSourceElementKind;
  readonly mime: string;
  readonly bytes: Uint8Array;
  readonly byteSize: number;
  readonly contentHash: `sha256:${string}`;
}

/**
 * Provider-neutral material emitted by a public-remote skill after parsing and VERIFY.
 * Array order is semantic: the host commits candidates and their elements in this exact order.
 */
export interface PublicSourceCandidateDraft {
  readonly type: string;
  /** Stable external identifiers; the server derives source identity from `type` + this map. */
  readonly keys: Readonly<Record<string, string>>;
  readonly sourceProperties: PublicSourceJsonObject;
  readonly retrievedAt?: string;
  readonly elements: readonly PublicSourceElementDraft[];
}

export interface PublicSourceVerifyCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Additional report fields must also be JSON-safe before the server persists them. */
export interface PublicSourceVerifyReport {
  readonly ok: boolean;
  readonly checks: readonly PublicSourceVerifyCheck[];
  readonly [key: string]: unknown;
}

export interface PublicRemoteParser {
  readonly name: string;
  readonly version: string;
  parse(bytes: Uint8Array): Promise<unknown>;
}

export type PublicRemoteNetworkCapability =
  | {
      /** Provider APIs are constructed by the skill and never taken from caller input. */
      readonly kind: "fixed_https_origins";
      readonly origins: readonly string[];
    }
  | {
      /** Caller- or provider-supplied URLs cross the server-owned public HTTPS/443 boundary. */
      readonly kind: "safe_public_https";
    };

export interface PublicRemoteSourceSkill {
  readonly skillId: string;
  readonly displayName: string;
  readonly manifest: SourceSkillManifest & { readonly source_kind: "public_remote" };
  readonly parser: PublicRemoteParser;
  readonly fetchPolicy: {
    /** Owner-and-skill scoped attempts allowed inside the rolling window. */
    readonly attempts: number;
    readonly windowHours: number;
  };
  readonly networkPolicy: {
    /** A non-empty, closed set of egress capabilities used by this implementation. */
    readonly capabilities: readonly PublicRemoteNetworkCapability[];
  };
  readonly capture: {
    readonly mime: string;
    label(config: unknown, fetchUuid: string): string;
  };

  /** Validates caller-facing source fields and returns the JSON persisted with the source. */
  normalizeConfig(input: unknown): PublicSourceJsonObject;
  /** Validates and decodes an already-persisted configuration. */
  parseConfig(value: unknown): unknown;
  /** Stable, secret-free skill state included in the server's source-state digest. */
  stateDigest(config: unknown): PublicSourceJsonValue;
  retrieve(config: unknown): Promise<Uint8Array>;
  verify(parsed: unknown, config: unknown): PublicSourceVerifyReport;
  candidates(parsed: unknown, config: unknown): readonly PublicSourceCandidateDraft[];
}

export interface PublicRemoteSourceCatalogInput {
  /** Exactly one current implementation per skill id. Used for manifests and new sources. */
  readonly current: readonly PublicRemoteSourceSkill[];
  /** Older fully pinned implementations retained for existing sources and deterministic replay. */
  readonly historical?: readonly PublicRemoteSourceSkill[];
}

export interface PublicRemoteSourcePin {
  readonly skillId: string;
  readonly connectorVersion: string;
  readonly parserName: string;
  readonly parserVersion: string;
}

/**
 * Executable public-remote capabilities. This runtime allowlist is deliberately separate from
 * transaction parsers because media-oriented skills emit a different intermediate representation.
 */
export class PublicRemoteSourceCatalog {
  readonly #currentSkills: readonly PublicRemoteSourceSkill[];
  readonly #installedSkills: readonly PublicRemoteSourceSkill[];
  readonly #currentBySkillId: ReadonlyMap<string, PublicRemoteSourceSkill>;
  readonly #byPin: ReadonlyMap<string, PublicRemoteSourceSkill>;
  readonly #manifests: readonly SourceSkillManifest[];

  constructor(input: PublicRemoteSourceCatalogInput) {
    if (!input || !Array.isArray(input.current) || !Array.isArray(input.historical ?? [])) {
      throw new Error("Public-remote source installation must declare current implementations");
    }
    const currentSkills = input.current.map(validatePublicRemoteSourceSkill);
    const historicalSkills = (input.historical ?? []).map(validatePublicRemoteSourceSkill);
    const manifestCatalog = new SourceSkillManifestCatalog(
      currentSkills.map(({ manifest }) => manifest),
    );
    const manifests = manifestCatalog.all();
    const currentBySkillId = new Map<string, PublicRemoteSourceSkill>();
    for (const skill of currentSkills) currentBySkillId.set(skill.skillId, skill);

    const byPin = new Map<string, PublicRemoteSourceSkill>();
    for (const skill of [...currentSkills, ...historicalSkills]) {
      if (!currentBySkillId.has(skill.skillId)) {
        throw new Error(
          `Historical public-remote source ${skill.skillId} has no designated current implementation`,
        );
      }
      const key = publicRemoteSourcePinKey(pinForSkill(skill));
      if (byPin.has(key)) {
        throw new Error(`Duplicate public-remote source implementation pin: ${key}`);
      }
      byPin.set(key, skill);
    }

    this.#currentSkills = Object.freeze(currentSkills);
    this.#installedSkills = Object.freeze([...currentSkills, ...historicalSkills]);
    this.#currentBySkillId = currentBySkillId;
    this.#byPin = byPin;
    this.#manifests = manifests;
  }

  currentImplementations(): readonly PublicRemoteSourceSkill[] {
    return this.#currentSkills;
  }

  installedImplementations(): readonly PublicRemoteSourceSkill[] {
    return this.#installedSkills;
  }

  manifests(): readonly SourceSkillManifest[] {
    return this.#manifests;
  }

  currentForSkillId(skillId: string): PublicRemoteSourceSkill | undefined {
    return this.#currentBySkillId.get(skillId);
  }

  forPinnedSource(pin: PublicRemoteSourcePin): PublicRemoteSourceSkill | undefined {
    return this.#byPin.get(publicRemoteSourcePinKey(pin));
  }
}

function validatePublicRemoteSourceSkill(value: PublicRemoteSourceSkill): PublicRemoteSourceSkill {
  const manifest = new SourceSkillManifestCatalog([value.manifest]).all()[0];
  if (!manifest || manifest.source_kind !== "public_remote") {
    throw new Error(`Public-remote source ${value.skillId} has an incompatible manifest`);
  }
  if (value.skillId !== manifest.skill_id || value.displayName !== manifest.label) {
    throw new Error(`Public-remote source ${value.skillId} has inconsistent identity metadata`);
  }
  if (
    value.parser.name !== manifest.parser.name ||
    value.parser.version !== manifest.parser.version
  ) {
    throw new Error(`Public-remote source ${value.skillId} has inconsistent parser metadata`);
  }
  assertPositiveInteger(value.fetchPolicy.attempts, `${value.skillId} fetch attempts`);
  assertPositiveInteger(value.fetchPolicy.windowHours, `${value.skillId} fetch window`);
  assertNetworkPolicy(value.skillId, value.networkPolicy);
  return value;
}

function assertNetworkPolicy(
  skillId: string,
  policy: PublicRemoteSourceSkill["networkPolicy"],
): void {
  if (!policy || !Array.isArray(policy.capabilities) || policy.capabilities.length === 0) {
    throw new Error(`Public-remote source ${skillId} must declare a network capability`);
  }
  const kinds = new Set<string>();
  for (const capability of policy.capabilities) {
    if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
      throw new Error(`Public-remote source ${skillId} has an invalid network capability`);
    }
    if (kinds.has(capability.kind)) {
      throw new Error(
        `Public-remote source ${skillId} repeats network capability ${capability.kind}`,
      );
    }
    kinds.add(capability.kind);
    if (capability.kind === "safe_public_https") {
      if (Object.keys(capability).length !== 1) {
        throw new Error(`Public-remote source ${skillId} has an invalid safe-public capability`);
      }
      continue;
    }
    if (capability.kind === "fixed_https_origins") {
      if (
        Object.keys(capability).some((key) => key !== "kind" && key !== "origins") ||
        !Array.isArray(capability.origins) ||
        capability.origins.length === 0 ||
        new Set(capability.origins).size !== capability.origins.length ||
        capability.origins.some(
          (origin: unknown) => typeof origin !== "string" || !isCanonicalHttpsOrigin(origin),
        )
      ) {
        throw new Error(`Public-remote source ${skillId} has an invalid fixed-origin capability`);
      }
      continue;
    }
    throw new Error(`Public-remote source ${skillId} has an unknown network capability`);
  }
}

function pinForSkill(skill: PublicRemoteSourceSkill): PublicRemoteSourcePin {
  return {
    skillId: skill.skillId,
    connectorVersion: skill.manifest.connector_version,
    parserName: skill.parser.name,
    parserVersion: skill.parser.version,
  };
}

function publicRemoteSourcePinKey(pin: PublicRemoteSourcePin): string {
  return JSON.stringify([pin.skillId, pin.connectorVersion, pin.parserName, pin.parserVersion]);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`);
}

function isCanonicalHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      url.origin === value
    );
  } catch {
    return false;
  }
}
