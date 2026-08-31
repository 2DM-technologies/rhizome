import {
  SOURCE_ACTION_KINDS,
  SOURCE_SKILL_ID_PATTERN,
  type ProblemCode,
  type SourceExecutionLimits,
  type SourceSkillManifest,
} from "../../../packages/store-contract/src/index.ts";

import {
  assertManifestTargetSchemaCoverage,
  assertSourceSkillManifest,
  immutableJson,
} from "../source-skills/manifest-catalog.ts";
import type {
  CandidateBundleCapability,
  SourceJsonObject,
  SourceJsonValue,
  SourceParser,
} from "../source-skills/candidate-bundle.ts";

export type { SourceJsonObject, SourceJsonValue } from "../source-skills/candidate-bundle.ts";

export type ConnectedSourceActionKind = (typeof SOURCE_ACTION_KINDS)[number];

export function isConnectedSourceActionKind(value: unknown): value is ConnectedSourceActionKind {
  return (SOURCE_ACTION_KINDS as readonly unknown[]).includes(value);
}

export interface ConnectedSourceActionEvidence {
  readonly kind: ConnectedSourceActionKind;
}

/** Internal skill-to-host control flow. Resume state is sealed before crossing the HTTP boundary. */
export class ConnectedSourceActionRequired extends Error {
  constructor(
    readonly skillId: string,
    readonly kind: ConnectedSourceActionKind,
    readonly resume: SourceJsonValue,
    readonly title: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ConnectedSourceActionRequired";
  }
}

export type CredentialFailureDisposition = "ambiguous" | "rejected";

/** A provider-safe connection failure that the credential lifecycle can classify generically. */
export class CredentialConnectionError extends Error {
  constructor(
    readonly code: string,
    readonly disposition: CredentialFailureDisposition,
    safeDetail: string,
  ) {
    super(safeDetail);
    this.name = "CredentialConnectionError";
  }
}

export interface ConnectedSourceErrorInit {
  status: 422 | 429;
  code: ProblemCode;
  title: string;
  detail: string;
  extensions?: SourceJsonObject;
}

/** A provider-safe source failure that server transports can expose without importing a skill. */
export class ConnectedSourceError extends Error {
  readonly status: 422 | 429;
  readonly code: ProblemCode;
  readonly title: string;
  readonly detail: string;
  readonly extensions: SourceJsonObject;
  readonly delegated?: ConnectedSourceErrorInit;
  readonly operationResult?: SourceJsonObject;

  constructor(
    readonly skillId: string,
    input: ConnectedSourceErrorInit & {
      delegated?: ConnectedSourceErrorInit;
      operationResult?: SourceJsonObject;
    },
  ) {
    super(input.detail);
    this.name = "ConnectedSourceError";
    this.status = input.status;
    this.code = input.code;
    this.title = input.title;
    this.detail = input.detail;
    this.extensions = input.extensions ?? {};
    this.delegated = input.delegated;
    this.operationResult = input.operationResult;
  }
}

/** Skill-owned recipe for recognizing claims fingerprinted before the current generic scheme. */
export interface CredentialClaimFingerprintCompatibility {
  /** Canonical claim material used by the historical fingerprint scheme. */
  readonly claim: string;
  /** Historical HKDF info used by the local-keyring adapter. */
  readonly localHkdfInfo: string;
  /** Historical pre-HMAC digest domain used by the KMS adapter. */
  readonly kmsDigestDomain: string;
}

export interface PreparedCredentialConnection {
  /** Canonical sensitive material. The server fingerprints it immediately and never stores it. */
  readonly replayKey: string;
  /** Optional skill-owned aliases that preserve replay protection across scheme migrations. */
  readonly fingerprintCompatibility?: readonly CredentialClaimFingerprintCompatibility[];
  /** The first operation allowed to contact or consume the provider credential. */
  acquire(): Promise<{ secret: string; publicMetadata?: SourceJsonObject }>;
}

export interface CredentialClaimPolicy {
  readonly kind: "single_use_global";
}

export interface ClaimExchangeConnectionDefinition {
  readonly mode: "claim_exchange";
  readonly claimPolicy: CredentialClaimPolicy;
  readonly requestSchema: Readonly<Record<string, unknown>>;
  prepare(input: unknown): PreparedCredentialConnection;
}

export interface OAuth2PkceCredentialResult {
  readonly secret: string;
  readonly publicMetadata?: SourceJsonObject;
}

/** Provider adapter for the server-owned OAuth 2.0 authorization-code + PKCE lifecycle. */
export interface OAuth2PkceConnectionDefinition {
  readonly mode: "oauth2_pkce";
  authorizationUrl(input: { callbackUrl: string; codeChallenge: string; state: string }): string;
  exchange(input: {
    callbackUrl: string;
    code: string;
    codeVerifier: string;
    signal: AbortSignal;
  }): Promise<OAuth2PkceCredentialResult>;
  callbackError?(input: { error: string; errorDescription?: string }): CredentialConnectionError;
  refresh?(
    secret: string,
    input: { signal: AbortSignal },
  ): Promise<OAuth2PkceCredentialResult | undefined>;
  revoke?(secret: string, input: { signal: AbortSignal }): Promise<void>;
}

export type CredentialConnectionDefinition =
  ClaimExchangeConnectionDefinition | OAuth2PkceConnectionDefinition;

export interface PreparedConnectedSourceFetch {
  retrieve(secret: string): Promise<Uint8Array>;
  readonly compiledSource: CandidateBundleCapability<{
    readonly bytes: Uint8Array;
    readonly limits: SourceExecutionLimits;
  }>;
  readonly actionEvidence?: ConnectedSourceActionEvidence;
}

export interface CredentialSourceConnector {
  readonly skillId: string;
  readonly displayName: string;
  readonly manifest: SourceSkillManifest;
  readonly connection: CredentialConnectionDefinition;
}

/** Credentialed capture capability layered on the generic connector and compiled-source boundary. */
export interface CredentialedSourceSkill extends CredentialSourceConnector {
  readonly parser: SourceParser;
  /** Closed schema for caller-supplied, non-secret source configuration. */
  readonly sourceRequestSchema: Readonly<Record<string, unknown>>;
  readonly fetchPolicy: {
    readonly attempts: number;
    readonly windowHours: number;
  };
  readonly capture: {
    readonly mime: string;
    label(fetchUuid: string): string;
  };

  parseConfig(value: unknown): unknown;
  prepareFetch(input: {
    config: unknown;
    endDateEpoch: number;
    previousCapture?: Uint8Array;
    resume?: SourceJsonValue;
  }): PreparedConnectedSourceFetch | Promise<PreparedConnectedSourceFetch>;
}

export interface SourceSkillDefinition<Settings> {
  readonly skillId: string;
  readonly parser: SourceParser;
  loadSettings(environment: Record<string, string | undefined>): Settings;
  create(settings: Settings): CredentialedSourceSkill;
}

/** Immutable registry today; this is the seam that can become generated/package discovery later. */
export class CredentialedSourceCatalog {
  readonly #bySkillId: ReadonlyMap<string, CredentialedSourceSkill>;
  readonly #manifests: readonly SourceSkillManifest[];

  constructor(skills: readonly CredentialedSourceSkill[]) {
    const bySkillId = new Map<string, CredentialedSourceSkill>();
    const manifests: SourceSkillManifest[] = [];
    const skillIdPattern = new RegExp(SOURCE_SKILL_ID_PATTERN);
    for (const skill of skills) {
      if (!skillIdPattern.test(skill.skillId)) {
        throw new Error(`Invalid credentialed-source skill id: ${skill.skillId}`);
      }
      if (bySkillId.has(skill.skillId)) {
        throw new Error(`Duplicate credentialed-source skill id: ${skill.skillId}`);
      }
      if (skill.manifest.skill_id !== skill.skillId) {
        throw new Error(
          `Credentialed-source manifest id ${skill.manifest.skill_id} does not match skill id ${skill.skillId}`,
        );
      }
      assertSourceSkillManifest(skill.manifest);
      if (skill.manifest.source_kind !== "credentialed_remote") {
        throw new Error(
          `Credentialed-source ${skill.skillId} has incompatible manifest kind ${skill.manifest.source_kind}`,
        );
      }
      if (!skill.manifest.connection) {
        throw new Error(`Credentialed-source ${skill.skillId} manifest needs connection policy`);
      }
      if (skill.manifest.label !== skill.displayName) {
        throw new Error(`Credentialed-source ${skill.skillId} has inconsistent display labels`);
      }
      if (
        skill.manifest.parser.name !== skill.parser.name ||
        skill.manifest.parser.version !== skill.parser.version
      ) {
        throw new Error(`Credentialed-source ${skill.skillId} has inconsistent parser metadata`);
      }
      assertConnectionManifestCoverage(skill);
      assertManifestTargetSchemaCoverage({
        skillId: skill.skillId,
        manifest: skill.manifest,
        target: "source",
        schema: skill.sourceRequestSchema,
        requireEveryProperty: false,
        label: "source request",
      });
      bySkillId.set(skill.skillId, skill);
      manifests.push(immutableJson(skill.manifest));
    }
    this.#bySkillId = bySkillId;
    this.#manifests = Object.freeze(manifests);
  }

  all(): readonly CredentialedSourceSkill[] {
    return [...this.#bySkillId.values()];
  }

  manifests(): readonly SourceSkillManifest[] {
    return this.#manifests;
  }

  forSkillId(skillId: string): CredentialedSourceSkill | undefined {
    return this.#bySkillId.get(skillId);
  }

  forSource(skillId: string, parser: string): CredentialedSourceSkill | undefined {
    const skill = this.forSkillId(skillId);
    return skill?.parser.name === parser ? skill : undefined;
  }
}

function assertConnectionManifestCoverage(skill: CredentialedSourceSkill): void {
  const manifestConnection = skill.manifest.connection;
  if (!manifestConnection || manifestConnection.mode !== skill.connection.mode) {
    throw new Error(
      `Credentialed-source ${skill.skillId} manifest has inconsistent connection mode`,
    );
  }
  if (skill.connection.mode === "oauth2_pkce") {
    if (
      manifestConnection.mode !== "oauth2_pkce" ||
      skill.manifest.input_fields.some(({ target }) => target === "connection")
    ) {
      throw new Error(`Credentialed-source ${skill.skillId} has an invalid OAuth connection`);
    }
    return;
  }
  if (
    manifestConnection.mode !== "claim_exchange" ||
    skill.connection.claimPolicy.kind !== "single_use_global" ||
    manifestConnection.claim_policy.kind !== skill.connection.claimPolicy.kind
  ) {
    throw new Error(`Credentialed-source ${skill.skillId} manifest has inconsistent claim policy`);
  }
  assertManifestTargetSchemaCoverage({
    skillId: skill.skillId,
    manifest: skill.manifest,
    target: "connection",
    schema: skill.connection.requestSchema,
    requireEveryProperty: true,
    label: "connection",
  });
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

export function delegatedConnectedSourceError(error: unknown): unknown {
  if (!(error instanceof ConnectedSourceError) || !error.delegated) return error;
  return new ConnectedSourceError(error.skillId, error.delegated);
}

export function connectedSourceOperationResult(error: unknown): SourceJsonObject | null {
  return error instanceof ConnectedSourceError ? (error.operationResult ?? null) : null;
}
