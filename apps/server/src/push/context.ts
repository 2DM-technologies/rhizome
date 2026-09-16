import { STORE_WRITER, storeTaskKey, type PushOperationResult } from "@rhizome/store-contract";
import type { MediaElement, MediaObjectElementRef, Vibe } from "@rnet/types";
import type { DbMediaElement } from "../db/models/media-element.ts";
import type { DbMediaObject } from "../db/models/media-object.ts";
import type { ModelConnectorRegistry } from "../inference/connector-registry.ts";
import { getVibeSummary } from "./installed-tasks.ts";
import type { PushLimits } from "./limits.ts";
import type { PushTaskDefinition } from "./task-catalog.ts";

export type JsonKind = "null" | "boolean" | "number" | "string" | "object" | { array: JsonKind[] };
export interface ObjectShape {
  type: string;
  pointers: Array<{ pointer: string; kind: JsonKind }>;
  keys: string[];
  elements: Array<{ kind: MediaElement["kind"]; role?: MediaObjectElementRef["role"] }>;
}
export interface VibeContext {
  title: string;
  summary?: string | null;
  objects: number;
  types: Array<{
    type: string;
    count: number;
    pointers: ObjectShape["pointers"];
    elements: Array<{ kind: MediaElement["kind"]; objects: number }>;
  }>;
  elements: Array<{ kind: MediaElement["kind"]; count: number }>;
  /** Installed-task-owned, bounded context prepared inside this push operation. */
  task_context?: Record<string, unknown>;
}
export type ContextCounts = PushOperationResult["context"];
export interface ContextObject {
  object: Pick<DbMediaObject, "uuid" | "type" | "source" | "user" | "keys" | "inferred">;
  elements: Array<{
    element: Pick<DbMediaElement, "uuid" | "kind" | "mime" | "alt" | "inferred"> &
      Partial<Pick<DbMediaElement, "contentHash" | "byteSize">>;
    role?: NonNullable<MediaObjectElementRef["role"]>;
  }>;
}

export const emptyContextCounts = (): ContextCounts => ({
  truncated_objects: 0,
  truncated_pointers: 0,
  clipped_objects: 0,
});

export function extractObjectShape(record: ContextObject): ObjectShape {
  const pointers: ObjectShape["pointers"] = [];
  function flatten(value: unknown, pointer: string, depth: number): void {
    if (isRecord(value) && Object.keys(value).length && depth < 3) {
      for (const [key, child] of Object.entries(value))
        flatten(child, `${pointer}/${escapePointer(key)}`, depth + 1);
    } else pointers.push({ pointer, kind: jsonKind(value) });
  }
  for (const [block, properties] of [
    ["source", record.object.source.properties],
    ["user", record.object.user?.properties],
  ] as const) {
    for (const [key, value] of Object.entries(properties ?? {}))
      flatten(value, `/${block}/properties/${escapePointer(key)}`, 1);
  }
  return {
    type: record.object.type,
    pointers,
    keys: Object.keys(record.object.keys),
    elements: record.elements.map(({ element, role }) => ({
      kind: element.kind,
      ...(role ? { role } : {}),
    })),
  };
}

export function assembleObjectContext(record: ContextObject, task: PushTaskDefinition) {
  const key = storeTaskKey(task.name);
  const raw = {
    type: record.object.type,
    shape: extractObjectShape(record),
    source: { properties: record.object.source.properties },
    ...(record.object.user ? { user: { properties: record.object.user.properties } } : {}),
    elements: record.elements.map(({ element, role }) => ({
      kind: element.kind,
      ...(role ? { role } : {}),
      alt: element.alt,
      inferred: storeNotes(element.inferred, key),
    })),
    notes: storeNotes(record.object.inferred, key),
  };
  const data = clipStrings(raw) as Record<string, unknown>;
  while (serializedBytes(data) > 2 * 1024) dropLastProperty(data);
  return { data, clipped: JSON.stringify(raw) !== JSON.stringify(data) };
}

export function assembleElementContext(element: Pick<DbMediaElement, "kind" | "mime" | "alt">) {
  return { kind: element.kind, mime: element.mime, alt: element.alt };
}

export function assembleObjectChunkContext(
  records: readonly ContextObject[],
  task: PushTaskDefinition,
) {
  const context = emptyContextCounts();
  const objects = records.map((record, index) => {
    const assembled = assembleObjectContext(record, task);
    if (assembled.clipped) context.clipped_objects++;
    return { ref: `o${index + 1}`, ...assembled.data };
  });
  return { input: dataBlock({ objects, context }), context };
}

export function assembleVibeContext(
  records: readonly ContextObject[],
  vibe: Pick<Vibe, "title" | "inferred">,
  task: PushTaskDefinition,
  taskContext?: Record<string, unknown>,
): { vibe: VibeContext; context: ContextCounts } {
  const distinct = distinctObjects(records);
  const types = new Map<string, VibeContext["types"][number]>();
  const elements = new Map<string, ContextObject["elements"][number]["element"]>();
  for (const record of distinct) {
    const shape = extractObjectShape(record);
    let type = types.get(shape.type);
    if (!type) {
      type = { type: shape.type, count: 0, pointers: [], elements: [] };
      types.set(shape.type, type);
    }
    type.count++;
    for (const pointer of shape.pointers) {
      if (!type.pointers.some((value) => JSON.stringify(value) === JSON.stringify(pointer)))
        type.pointers.push(pointer);
    }
    for (const kind of new Set(record.elements.map(({ element }) => element.kind))) {
      const count = type.elements.find((value) => value.kind === kind);
      if (count) count.objects++;
      else type.elements.push({ kind, objects: 1 });
    }
    for (const { element } of record.elements) elements.set(element.uuid, element);
  }
  const elementCounts: VibeContext["elements"] = [];
  for (const element of elements.values()) {
    const count = elementCounts.find((value) => value.kind === element.kind);
    if (count) count.count++;
    else elementCounts.push({ kind: element.kind, count: 1 });
  }
  const summary = getVibeSummary(vibe.inferred, task);
  const result: VibeContext = {
    title: vibe.title,
    ...(summary === undefined ? {} : { summary }),
    objects: distinct.length,
    types: [...types.values()],
    elements: elementCounts,
    ...(taskContext ? { task_context: taskContext } : {}),
  };
  const context = emptyContextCounts();
  const dropType = () => {
    const type = result.types.pop()!;
    context.truncated_objects += type.count;
    context.truncated_pointers += type.pointers.length;
  };
  while (result.types.length > 64) dropType();
  let pointers = result.types.reduce((sum, type) => sum + type.pointers.length, 0);
  const dropPointer = () => {
    const type = [...result.types].reverse().find((type) => type.pointers.length);
    if (!type) return false;
    type.pointers.pop();
    pointers--;
    context.truncated_pointers++;
    return true;
  };
  while (pointers > 512) dropPointer();
  while (serializedBytes(result) > 8 * 1024 && dropPointer()) {
    /* trim trailing pointers first */
  }
  while (serializedBytes(result) > 8 * 1024 && result.types.length) dropType();
  return { vibe: result, context };
}

export async function assembleVibeInput(
  records: readonly ContextObject[],
  vibe: Pick<Vibe, "title" | "inferred">,
  task: PushTaskDefinition,
  registry: ModelConnectorRegistry,
  limits: PushLimits,
  prepared?: ReturnType<typeof assembleVibeContext>,
) {
  const assembled = prepared ?? assembleVibeContext(records, vibe, task);
  const types = new Set(assembled.vibe.types.map((type) => type.type));
  const members = distinctObjects(records)
    .filter((record) => types.has(record.object.type))
    .map((record) => assembleObjectContext(record, task));
  for (;;) {
    const context = {
      ...assembled.context,
      clipped_objects: members.filter((member) => member.clipped).length,
    };
    const input = dataBlock({
      vibe: assembled.vibe,
      objects: members.map(({ data }) => data),
      context,
    });
    const tokens = await registry.connector.countTokens({
      target: registry.target,
      instructions: task.prompt,
      input,
    });
    if (tokens <= limits.maxInputTokensPerCall) return { ...assembled, context, input };
    if (!members.length) return { ...assembled, context, input: null };
    members.pop();
    assembled.context.truncated_objects++;
  }
}

export function dataBlock(data: unknown): string {
  return `<data>${JSON.stringify(data)}</data>`;
}
export function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function distinctObjects(records: readonly ContextObject[]): ContextObject[] {
  const distinct = new Map<string, ContextObject>();
  for (const record of records)
    if (!distinct.has(record.object.uuid)) distinct.set(record.object.uuid, record);
  return [...distinct.values()];
}
function storeNotes(inferred: Record<string, unknown>, ownKey: string) {
  return Object.fromEntries(
    Object.entries(inferred).filter(
      ([key]) => key.startsWith(`${STORE_WRITER}:`) && key !== ownKey,
    ),
  );
}
function escapePointer(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}
function jsonKind(value: unknown, depth = 0): JsonKind {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const kinds = depth < 3 ? value.map((item) => jsonKind(item, depth + 1)) : [];
    return { array: [...new Map(kinds.map((kind) => [JSON.stringify(kind), kind])).values()] };
  }
  return typeof value as Exclude<JsonKind, { array: JsonKind[] }>;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function clipStrings(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 512);
  if (Array.isArray(value)) return value.map(clipStrings);
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, clipStrings(child)]),
    );
  return value;
}
function dropLastProperty(value: Record<string, unknown>): void {
  const key = Object.keys(value).at(-1);
  if (key === undefined) throw new Error("Cannot clip empty object context");
  const child = value[key];
  if (Array.isArray(child) && child.length) child.pop();
  else if (isRecord(child) && Object.keys(child).length) dropLastProperty(child);
  else delete value[key];
}
