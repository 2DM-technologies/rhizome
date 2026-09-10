import type { MediaObject, Vibe } from "@rnet/types";
import { resolvePointer, storeTaskKey, VIBE_VIEWS } from "@rhizome/store-contract";
import { PUSH_TASKS } from "../api/generated/push-tasks.ts";
import { uuidOf } from "../api/uris.ts";
import { useMediaElement, usePayloadUrl } from "../queries/index.ts";

type View = (typeof VIBE_VIEWS)[number];
type Config = Record<string, unknown>;
interface Props {
  objects: MediaObject[];
  vibe: Vibe;
  openObject: (object: MediaObject) => void;
  removeObject?: (object: MediaObject) => void;
  removePending?: boolean;
}
type RowsProps = Omit<Props, "vibe"> & { config: Config };
function properties(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const candidate = (value as Record<string, unknown>).properties;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : undefined;
}
export function inferredObjectLabel(object: MediaObject): string {
  const display = properties(
    object.inferred?.[storeTaskKey(PUSH_TASKS.object.display_name.name)],
  )?.display_name;
  return typeof display === "string" && display.trim()
    ? display.trim()
    : `${object.type} ${object.uri.split("/").at(-1) ?? object.uri}`;
}
export function inferredVibeView(vibe: Vibe): View | undefined {
  const view = properties(vibe.inferred?.[storeTaskKey(PUSH_TASKS.vibe.vibe_view.name)])?.view;
  return VIBE_VIEWS.find((candidate) => candidate === view);
}
function displayValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}
function ImageElement({ uri, label }: { uri: string; label: string }) {
  const id = uuidOf(uri);
  const element = useMediaElement(id);
  const payload = usePayloadUrl("elements", element.data?.kind === "image" ? id : undefined);
  if (element.data?.kind !== "image") return null;
  return (
    <img
      className="aspect-square w-full rounded-md object-cover"
      src={payload.data}
      alt={element.data.alt ?? label}
    />
  );
}
function Actions({
  object,
  openObject,
  removeObject,
  removePending,
}: Pick<RowsProps, "openObject" | "removeObject" | "removePending"> & { object: MediaObject }) {
  return (
    <span className="flex gap-2">
      <button
        type="button"
        className="text-link"
        aria-label={`Open object ${object.uri}`}
        onClick={() => openObject(object)}
      >
        Open
      </button>
      {removeObject && object.source.ingest.method === "authored" ? (
        <button
          type="button"
          className="text-link"
          aria-label={`Remove ${object.uri} from Vibe`}
          disabled={removePending}
          onClick={() => removeObject(object)}
        >
          Remove
        </button>
      ) : null}
    </span>
  );
}
export function InferredVibeView({ objects, vibe, ...actions }: Props) {
  const summary = properties(vibe.inferred?.[storeTaskKey(PUSH_TASKS.vibe.summarize.name)]);
  const entry = properties(vibe.inferred?.[storeTaskKey(PUSH_TASKS.vibe.vibe_view.name)]);
  const view = inferredVibeView(vibe);
  const raw = entry?.config;
  const config =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Config) : undefined;
  return (
    <>
      {typeof summary?.summary === "string" ? (
        <section aria-labelledby="vibe-summary-heading" className="mb-7">
          <h2 id="vibe-summary-heading" className="mb-2 text-label text-primary">
            Summary
          </h2>
          <p className="text-body text-secondary">{summary.summary}</p>
        </section>
      ) : null}
      {view && config ? (
        <section aria-label="Inferred Vibe view" data-vibe-view={view} className="mb-8">
          {view === "simplelist" ? (
            <SimpleList objects={objects} config={config} {...actions} />
          ) : null}
          {view === "datatable" ? (
            <DataTable objects={objects} config={config} {...actions} />
          ) : null}
          {view === "mediaboard" ? (
            <MediaBoard objects={objects} config={config} {...actions} />
          ) : null}
        </section>
      ) : null}
    </>
  );
}
function SimpleList({ objects, config, ...actions }: RowsProps) {
  const pointer = typeof config.subtitle_pointer === "string" ? config.subtitle_pointer : undefined;
  return (
    <ul className="divide-y divide-hairline">
      {objects.map((object, index) => (
        <li key={`${object.uri}:${index}`} className="flex items-center justify-between gap-3 py-3">
          <div>
            <div className="text-label text-primary">{inferredObjectLabel(object)}</div>
            {pointer ? (
              <div className="text-caption text-tertiary">
                {displayValue(resolvePointer(object, pointer))}
              </div>
            ) : null}
          </div>
          <Actions object={object} {...actions} />
        </li>
      ))}
    </ul>
  );
}
function DataTable({ objects, config, ...actions }: RowsProps) {
  const columns = Array.isArray(config.columns)
    ? config.columns.filter((v): v is string => typeof v === "string")
    : [];
  const sort =
    config.sort && typeof config.sort === "object"
      ? (config.sort as { pointer?: unknown; direction?: unknown })
      : undefined;
  const rows = objects.map((object, position) => ({ object, position }));
  if (typeof sort?.pointer === "string")
    rows.sort((a, b) => {
      const av = resolvePointer(a.object, sort.pointer as string),
        bv = resolvePointer(b.object, sort.pointer as string);
      const order =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : displayValue(av).localeCompare(displayValue(bv));
      return order * (sort.direction === "desc" ? -1 : 1);
    });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-body">
        <thead>
          <tr>
            <th className="p-3">Object</th>
            {columns.map((c, index) => (
              <th key={`${c}:${index}`} className="p-3 font-mono text-caption">
                {c.split("/").at(-1)}
              </th>
            ))}
            <th className="p-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ object, position }) => (
            <tr key={`${object.uri}:${position}`} className="border-t border-hairline">
              <th className="p-3 font-normal">{inferredObjectLabel(object)}</th>
              {columns.map((c, index) => (
                <td key={`${c}:${index}`} className="p-3">
                  {displayValue(resolvePointer(object, c))}
                </td>
              ))}
              <td className="p-3">
                <Actions object={object} {...actions} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function MediaBoard({ objects, config, ...actions }: RowsProps) {
  const caption = typeof config.caption_pointer === "string" ? config.caption_pointer : undefined;
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {objects.map((object, index) => (
        <li key={`${object.uri}:${index}`}>
          <div className="grid grid-cols-2 gap-2">
            {object.elements.map(({ uri }, i) => (
              <ImageElement key={`${uri}:${i}`} uri={uri} label={inferredObjectLabel(object)} />
            ))}
          </div>
          <div className="mt-2 text-label text-primary">{inferredObjectLabel(object)}</div>
          {caption ? (
            <div className="text-caption text-tertiary">
              {displayValue(resolvePointer(object, caption))}
            </div>
          ) : null}
          <Actions object={object} {...actions} />
        </li>
      ))}
    </ul>
  );
}
