import {
  SOURCE_ACTION_KINDS,
  SOURCE_CREDENTIAL_CLAIM_POLICIES,
  SOURCE_SKILL_INPUT_CONTROLS,
  SOURCE_SKILL_INPUT_TARGETS,
  SOURCE_SKILL_KINDS,
  SOURCE_SKILL_ID_PATTERN,
  SOURCE_SKILL_REVIEW_ACTIONS,
  type ProblemCode,
  type SourceSkillManifest,
} from "../../../packages/store-contract/src/index.ts";

import type { TransactionParser, ParsedTransactions } from "../transactions/types.ts";
import type { VerifyReport, VerifyTransactionsOptions } from "../transactions/verify.ts";

export type SourceJsonValue =
  boolean | number | string | null | SourceJsonValue[] | { [key: string]: SourceJsonValue };

export type SourceJsonObject = { [key: string]: SourceJsonValue };

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
  readonly attempts: number;
  readonly windowHours: number;
}

export interface CredentialConnectionDefinition {
  readonly claimPolicy: CredentialClaimPolicy;
  readonly requestSchema: Readonly<Record<string, unknown>>;
  prepare(input: unknown): PreparedCredentialConnection;
}

export interface PreparedConnectedSourceFetch {
  retrieve(secret: string): Promise<Uint8Array>;
  readonly verifyOptions: VerifyTransactionsOptions;
  readonly actionEvidence?: ConnectedSourceActionEvidence;
}

export interface CredentialSourceConnector {
  readonly skillId: string;
  readonly displayName: string;
  readonly manifest: SourceSkillManifest;
  readonly connection: CredentialConnectionDefinition;
}

/** Transaction-specific execution capability layered on the generic credential connector. */
export interface CredentialedSourceSkill extends CredentialSourceConnector {
  readonly parser: TransactionParser;
  readonly fetchPolicy: {
    readonly attempts: number;
    readonly windowHours: number;
  };
  readonly capture: {
    readonly mime: string;
    label(fetchUuid: string): string;
  };

  parseConfig(value: unknown): unknown;
  normalize(parsed: ParsedTransactions, config: unknown): ParsedTransactions;
  identitySourceProperties(properties: Record<string, unknown>): Record<string, unknown>;
  prepareFetch(input: {
    config: unknown;
    endDateEpoch: number;
    previous?: ParsedTransactions;
    resume?: SourceJsonValue;
  }): PreparedConnectedSourceFetch;
  verificationError(report: VerifyReport): ConnectedSourceActionRequired | undefined;
}

export interface SourceSkillDefinition<Settings> {
  readonly skillId: string;
  readonly parser: TransactionParser;
  loadSettings(environment: Record<string, string | undefined>): Settings;
  create(settings: Settings): CredentialedSourceSkill;
}

/** Data-only catalog consumed by API/UI layers; executable capabilities stay in typed catalogs. */
export class SourceSkillManifestCatalog {
  readonly #manifests: readonly SourceSkillManifest[];
  readonly #bySkillId: ReadonlyMap<string, SourceSkillManifest>;

  constructor(values: readonly unknown[]) {
    const ids = new Set<string>();
    const manifests = values.map((value) => {
      assertSourceSkillManifest(value);
      if (ids.has(value.skill_id)) {
        throw new Error(`Duplicate source-skill manifest: ${value.skill_id}`);
      }
      ids.add(value.skill_id);
      return immutableJson(value);
    });
    this.#manifests = Object.freeze(manifests);
    this.#bySkillId = new Map(manifests.map((manifest) => [manifest.skill_id, manifest]));
  }

  all(): readonly SourceSkillManifest[] {
    return this.#manifests;
  }

  forSkillId(skillId: string): SourceSkillManifest | undefined {
    return this.#bySkillId.get(skillId);
  }
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

function assertSourceSkillManifest(value: unknown): asserts value is SourceSkillManifest {
  if (!isRecord(value)) throw new Error("Source-skill manifest must be an object");
  if (!isJsonValue(value, new Set())) {
    throw new Error("Source-skill manifest must contain only serializable JSON values");
  }
  assertOnlyKeys(value, [
    "skill_id",
    "label",
    "description",
    "source_kind",
    "connector_version",
    "parser",
    "connection",
    "input_fields",
    "review_actions",
  ]);
  const skillIdPattern = new RegExp(SOURCE_SKILL_ID_PATTERN);
  if (typeof value.skill_id !== "string" || !skillIdPattern.test(value.skill_id)) {
    throw new Error("Source-skill manifest has an invalid skill_id");
  }
  if (!boundedString(value.label, 1, 256) || !boundedString(value.description, 1, 2_048)) {
    throw new Error(`Source-skill ${value.skill_id} must declare a label and description`);
  }
  if (!includes(SOURCE_SKILL_KINDS, value.source_kind)) {
    throw new Error(`Source-skill ${value.skill_id} has an invalid source_kind`);
  }
  if (!boundedString(value.connector_version, 1, 256)) {
    throw new Error(`Source-skill ${value.skill_id} must declare a connector version`);
  }
  if (
    !isRecord(value.parser) ||
    !onlyKeys(value.parser, ["name", "version"]) ||
    !boundedString(value.parser.name, 1, 256) ||
    !boundedString(value.parser.version, 1, 256)
  ) {
    throw new Error(`Source-skill ${value.skill_id} must declare parser metadata`);
  }
  if (!Array.isArray(value.input_fields)) {
    throw new Error(`Source-skill ${value.skill_id} input_fields must be an array`);
  }
  if (value.connection !== undefined) {
    if (!isRecord(value.connection) || !isRecord(value.connection.claim_policy)) {
      throw new Error(`Source-skill ${value.skill_id} has an invalid connection policy`);
    }
    if (
      value.source_kind !== "credentialed_remote" ||
      !onlyKeys(value.connection, ["claim_policy"]) ||
      !onlyKeys(value.connection.claim_policy, ["kind", "attempts", "window_hours"])
    ) {
      throw new Error(`Source-skill ${value.skill_id} has an invalid connection policy`);
    }
    const policy = value.connection.claim_policy;
    if (
      !includes(SOURCE_CREDENTIAL_CLAIM_POLICIES, policy.kind) ||
      !boundedInteger(policy.attempts, 1, 1_000) ||
      !boundedInteger(policy.window_hours, 1, 720)
    ) {
      throw new Error(`Source-skill ${value.skill_id} has an invalid connection policy`);
    }
  } else if (value.source_kind === "credentialed_remote") {
    throw new Error(`Source-skill ${value.skill_id} needs a connection policy`);
  }
  const fieldKeys = new Set<string>();
  for (const field of value.input_fields) {
    if (!isRecord(field) || !/^[a-z][a-z0-9_]{0,63}$/.test(String(field.name))) {
      throw new Error(`Source-skill ${value.skill_id} has an invalid input field`);
    }
    assertOnlyKeys(field, [
      "name",
      "label",
      "target",
      "control",
      "required",
      "secret",
      "placeholder",
      "help_text",
      "help_url",
      "accept",
      "options",
    ]);
    if (
      !boundedString(field.label, 1, 256) ||
      !includes(SOURCE_SKILL_INPUT_TARGETS, field.target) ||
      !includes(SOURCE_SKILL_INPUT_CONTROLS, field.control) ||
      typeof field.required !== "boolean" ||
      typeof field.secret !== "boolean"
    ) {
      throw new Error(`Source-skill ${value.skill_id} field ${field.name} is invalid`);
    }
    if (field.target === "source" && field.secret) {
      throw new Error(
        `Source-skill ${value.skill_id} field ${field.name} cannot store a secret in source config`,
      );
    }
    const key = `${field.target}:${field.name}`;
    if (fieldKeys.has(key)) {
      throw new Error(`Source-skill ${value.skill_id} has duplicate input field ${key}`);
    }
    fieldKeys.add(key);
    if (
      (field.placeholder !== undefined && !boundedString(field.placeholder, 0, 512)) ||
      (field.help_text !== undefined && !boundedString(field.help_text, 0, 2_048)) ||
      (field.help_url !== undefined && !isCanonicalHttps(field.help_url))
    ) {
      throw new Error(`Source-skill ${value.skill_id} field ${field.name} is invalid`);
    }
    if (
      field.accept !== undefined &&
      (!Array.isArray(field.accept) ||
        new Set(field.accept).size !== field.accept.length ||
        field.accept.some((entry) => !nonempty(entry)))
    ) {
      throw new Error(`Source-skill ${value.skill_id} field ${field.name} is invalid`);
    }
    if (field.options !== undefined) {
      if (
        field.control !== "select" ||
        !Array.isArray(field.options) ||
        field.options.length === 0 ||
        field.options.some(
          (option) =>
            !isRecord(option) ||
            !onlyKeys(option, ["value", "label"]) ||
            !boundedString(option.value, 1, 512) ||
            !boundedString(option.label, 1, 256),
        ) ||
        new Set(
          field.options.flatMap((option) =>
            isRecord(option) && typeof option.value === "string" ? [option.value] : [],
          ),
        ).size !== field.options.length
      ) {
        throw new Error(`Source-skill ${value.skill_id} field ${field.name} is invalid`);
      }
    } else if (field.control === "select") {
      throw new Error(`Source-skill ${value.skill_id} select field ${field.name} needs options`);
    }
  }
  if (
    !Array.isArray(value.review_actions) ||
    value.review_actions.some((action) => !includes(SOURCE_SKILL_REVIEW_ACTIONS, action)) ||
    new Set(value.review_actions).size !== value.review_actions.length
  ) {
    throw new Error(`Source-skill ${value.skill_id} has invalid review actions`);
  }
}

function assertConnectionManifestCoverage(skill: CredentialedSourceSkill): void {
  if (
    skill.connection.claimPolicy.kind !== "single_use_global" ||
    !boundedInteger(skill.connection.claimPolicy.attempts, 1, 1_000) ||
    !boundedInteger(skill.connection.claimPolicy.windowHours, 1, 720)
  ) {
    throw new Error(`Credentialed-source ${skill.skillId} has an invalid claim policy`);
  }
  const manifestPolicy = skill.manifest.connection?.claim_policy;
  if (
    !manifestPolicy ||
    manifestPolicy.kind !== skill.connection.claimPolicy.kind ||
    manifestPolicy.attempts !== skill.connection.claimPolicy.attempts ||
    manifestPolicy.window_hours !== skill.connection.claimPolicy.windowHours
  ) {
    throw new Error(`Credentialed-source ${skill.skillId} manifest has inconsistent claim policy`);
  }
  const schema = skill.connection.requestSchema;
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    throw new Error(
      `Credentialed-source ${skill.skillId} connection schema must be a closed object`,
    );
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? new Set(schema.required.filter((name): name is string => typeof name === "string"))
    : new Set<string>();
  const fields = skill.manifest.input_fields.filter(({ target }) => target === "connection");
  const fieldNames = new Set(fields.map(({ name }) => name));
  const propertyNames = Object.keys(properties);
  if (
    fieldNames.size !== fields.length ||
    propertyNames.some((name) => !fieldNames.has(name)) ||
    [...required].some((name) => !fieldNames.has(name)) ||
    fields.some(({ name }) => !(name in properties)) ||
    fields.some(({ name, required: fieldRequired }) =>
      fieldRequired ? !required.has(name) : required.has(name),
    )
  ) {
    throw new Error(
      `Credentialed-source ${skill.skillId} manifest does not cover its connection schema`,
    );
  }
}

function includes<const Values extends readonly unknown[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return values.includes(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function boundedString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" && value.length >= minimumLength && value.length <= maximumLength
  );
}

function isCanonicalHttps(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.href === value;
  } catch {
    return false;
  }
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (!onlyKeys(value, allowed)) throw new Error("Source-skill manifest has unknown properties");
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function immutableJson<Value>(value: Value): Value {
  const clone = JSON.parse(JSON.stringify(value)) as Value;
  return deepFreeze(clone);
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function delegatedConnectedSourceError(error: unknown): unknown {
  if (!(error instanceof ConnectedSourceError) || !error.delegated) return error;
  return new ConnectedSourceError(error.skillId, error.delegated);
}

export function connectedSourceOperationResult(error: unknown): SourceJsonObject | null {
  return error instanceof ConnectedSourceError ? (error.operationResult ?? null) : null;
}
