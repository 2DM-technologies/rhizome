import {
  SOURCE_CREDENTIAL_CLAIM_POLICIES,
  FILE_CAPTURE_PREPROCESSOR_CAPABILITY,
  SOURCE_SKILL_INPUT_CONTROLS,
  SOURCE_SKILL_INPUT_TARGETS,
  SOURCE_SKILL_KINDS,
  SOURCE_SKILL_ID_PATTERN,
  SOURCE_SKILL_REVIEW_ACTIONS,
  type SourceSkillManifest,
} from "../../../packages/store-contract/src/index.ts";

/** Immutable data-only catalog shared by every source-skill execution kind. */
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

export function assertSourceSkillManifest(value: unknown): asserts value is SourceSkillManifest {
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
    "limits",
    "file_capture",
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
  assertExecutionLimits(value);
  assertFileCapturePreprocessor(value);
  if (!Array.isArray(value.input_fields)) {
    throw new Error(`Source-skill ${value.skill_id} input_fields must be an array`);
  }
  assertConnectionPolicy(value);
  assertInputFields(value, value.input_fields);
  assertSourceKindInputContract(value, value.input_fields);
  if (
    !Array.isArray(value.review_actions) ||
    value.review_actions.some((action) => !includes(SOURCE_SKILL_REVIEW_ACTIONS, action)) ||
    new Set(value.review_actions).size !== value.review_actions.length
  ) {
    throw new Error(`Source-skill ${value.skill_id} has invalid review actions`);
  }
}

function assertExecutionLimits(manifest: Record<string, unknown>): void {
  const limits = manifest.limits;
  const keys = ["maxCandidates", "maxCaptureBytes", "maxElementBytes", "maxTotalElementBytes"];
  if (!isRecord(limits) || !onlyKeys(limits, keys) || keys.some((key) => !(key in limits))) {
    throw new Error(`Source-skill ${manifest.skill_id} has invalid execution limits`);
  }
  for (const value of Object.values(limits)) {
    if (!boundedInteger(value, 1, 2_147_483_647)) {
      throw new Error(`Source-skill ${manifest.skill_id} has invalid execution limits`);
    }
  }
}

function assertFileCapturePreprocessor(manifest: Record<string, unknown>): void {
  if (manifest.file_capture === undefined) return;
  const capability = manifest.file_capture;
  const skillIdPattern = new RegExp(SOURCE_SKILL_ID_PATTERN);
  if (
    manifest.source_kind !== "file" ||
    !isRecord(capability) ||
    !onlyKeys(capability, ["kind", "implementation", "version"]) ||
    capability.kind !== FILE_CAPTURE_PREPROCESSOR_CAPABILITY ||
    typeof capability.implementation !== "string" ||
    !skillIdPattern.test(capability.implementation) ||
    !boundedString(capability.version, 1, 256)
  ) {
    throw new Error(`Source-skill ${manifest.skill_id} has an invalid file capture preprocessor`);
  }
}

function assertConnectionPolicy(manifest: Record<string, unknown>): void {
  if (manifest.connection === undefined) {
    if (manifest.source_kind === "credentialed_remote") {
      throw new Error(`Source-skill ${manifest.skill_id} needs a connection policy`);
    }
    return;
  }
  if (!isRecord(manifest.connection) || manifest.source_kind !== "credentialed_remote") {
    throw new Error(`Source-skill ${manifest.skill_id} has an invalid connection policy`);
  }
  if (manifest.connection.mode === "oauth2_pkce") {
    if (
      !onlyKeys(manifest.connection, ["mode", "button_label"]) ||
      !boundedString(manifest.connection.button_label, 1, 256)
    ) {
      throw new Error(`Source-skill ${manifest.skill_id} has an invalid connection policy`);
    }
    return;
  }
  if (
    manifest.connection.mode !== "claim_exchange" ||
    !onlyKeys(manifest.connection, ["mode", "claim_policy"]) ||
    !isRecord(manifest.connection.claim_policy) ||
    !onlyKeys(manifest.connection.claim_policy, ["kind"]) ||
    !includes(SOURCE_CREDENTIAL_CLAIM_POLICIES, manifest.connection.claim_policy.kind)
  ) {
    throw new Error(`Source-skill ${manifest.skill_id} has an invalid connection policy`);
  }
}

function assertInputFields(manifest: Record<string, unknown>, inputFields: unknown[]): void {
  const fieldKeys = new Set<string>();
  for (const field of inputFields) {
    if (!isRecord(field) || !/^[a-z][a-z0-9_]{0,63}$/.test(String(field.name))) {
      throw new Error(`Source-skill ${manifest.skill_id} has an invalid input field`);
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
      throw new Error(`Source-skill ${manifest.skill_id} field ${field.name} is invalid`);
    }
    if (field.target === "source" && field.secret) {
      throw new Error(
        `Source-skill ${manifest.skill_id} field ${field.name} cannot store a secret in source config`,
      );
    }
    if (field.secret && field.control !== "text") {
      throw new Error(
        `Source-skill ${manifest.skill_id} secret field ${field.name} must use a text control`,
      );
    }
    const key = `${field.target}:${field.name}`;
    if (fieldKeys.has(key)) {
      throw new Error(`Source-skill ${manifest.skill_id} has duplicate input field ${key}`);
    }
    fieldKeys.add(key);
    if (
      (field.placeholder !== undefined && !boundedString(field.placeholder, 0, 512)) ||
      (field.help_text !== undefined && !boundedString(field.help_text, 0, 2_048)) ||
      (field.help_url !== undefined && !isCanonicalHttps(field.help_url))
    ) {
      throw new Error(`Source-skill ${manifest.skill_id} field ${field.name} is invalid`);
    }
    if (
      field.accept !== undefined &&
      (!Array.isArray(field.accept) ||
        field.control !== "file" ||
        new Set(field.accept).size !== field.accept.length ||
        field.accept.some((entry) => !nonempty(entry)))
    ) {
      throw new Error(`Source-skill ${manifest.skill_id} field ${field.name} is invalid`);
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
        throw new Error(`Source-skill ${manifest.skill_id} field ${field.name} is invalid`);
      }
    } else if (field.control === "select") {
      throw new Error(`Source-skill ${manifest.skill_id} select field ${field.name} needs options`);
    }
  }
}

function assertSourceKindInputContract(
  manifest: Record<string, unknown>,
  inputFields: unknown[],
): void {
  const fields = inputFields as Array<Record<string, unknown>>;
  if (manifest.source_kind === "file") {
    const file = fields[0];
    if (
      fields.length !== 1 ||
      file?.target !== "source" ||
      file.control !== "file" ||
      file.required !== true ||
      file.secret !== false
    ) {
      throw new Error(
        `File source-skill ${manifest.skill_id} must declare exactly one required source file field`,
      );
    }
    return;
  }
  if (fields.some(({ control }) => control === "file")) {
    throw new Error(`Remote source-skill ${manifest.skill_id} cannot declare file fields`);
  }
  if (
    manifest.source_kind === "public_remote" &&
    fields.some(({ target }) => target !== "source")
  ) {
    throw new Error(`Public source-skill ${manifest.skill_id} cannot declare connection fields`);
  }
}

export function assertManifestTargetSchemaCoverage({
  skillId,
  manifest,
  target,
  schema,
  requireEveryProperty,
  label,
}: {
  skillId: string;
  manifest: SourceSkillManifest;
  target: SourceSkillManifest["input_fields"][number]["target"];
  schema: Readonly<Record<string, unknown>>;
  requireEveryProperty: boolean;
  label: string;
}): void {
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    throw new Error(`Source-skill ${skillId} ${label} schema must be a closed object`);
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const rawRequired = schema.required;
  if (
    rawRequired !== undefined &&
    (!Array.isArray(rawRequired) || rawRequired.some((name) => typeof name !== "string"))
  ) {
    throw new Error(`Source-skill ${skillId} ${label} schema has invalid required fields`);
  }
  const required = new Set((rawRequired ?? []) as string[]);
  const fields = manifest.input_fields.filter((field) => field.target === target);
  const fieldNames = new Set(fields.map(({ name }) => name));
  const propertyNames = Object.keys(properties);
  if (
    fieldNames.size !== fields.length ||
    [...required].some((name) => !(name in properties) || !fieldNames.has(name)) ||
    fields.some(({ name }) => !(name in properties)) ||
    fields.some(({ name, required: fieldRequired }) =>
      fieldRequired ? !required.has(name) : required.has(name),
    ) ||
    (requireEveryProperty && propertyNames.some((name) => !fieldNames.has(name)))
  ) {
    throw new Error(`Source-skill ${skillId} manifest does not cover its ${label} schema`);
  }
  for (const field of fields) {
    const property = properties[field.name];
    if (!isRecord(property) || !inputControlMatchesSchema(field, property)) {
      throw new Error(
        `Source-skill ${skillId} field ${field.name} does not match its ${label} schema`,
      );
    }
  }
}

function inputControlMatchesSchema(
  field: SourceSkillManifest["input_fields"][number],
  property: Record<string, unknown>,
): boolean {
  if (field.control === "checkbox") return property.type === "boolean";
  if (field.control === "file") return false;
  if (property.type !== "string") return false;
  if (field.control !== "select" || property.enum === undefined) return true;
  const allowed = property.enum;
  return (
    Array.isArray(allowed) && field.options?.every(({ value }) => allowed.includes(value)) === true
  );
}

export function immutableJson<Value>(value: Value): Value {
  const clone = JSON.parse(JSON.stringify(value)) as Value;
  return deepFreeze(clone);
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

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
