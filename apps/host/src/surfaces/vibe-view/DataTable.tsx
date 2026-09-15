import { resolvePointer } from "@rhizome/store-contract";
import { uuidOf } from "../../api/uris.ts";
import { pathOf } from "../../shell/surfaces.ts";
import { Actions } from "./Actions.tsx";
import type { RowsProps } from "./types.ts";
import { displayValue, inferredObjectLabel } from "./utils.ts";

export function DataTable({ objects, config, ...actions }: RowsProps) {
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
            <tr
              key={`${object.uri}:${position}`}
              className="cursor-pointer border-t border-hairline hover:bg-canvas"
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  (event.target instanceof Element && event.target.closest("a, button")) ||
                  window.getSelection()?.isCollapsed === false
                )
                  return;
                actions.openObject(object);
              }}
            >
              <th scope="row" className="p-3 font-normal">
                <a
                  href={pathOf({ kind: "object", uuid: uuidOf(object.uri) })}
                  className="text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={(event) => {
                    if (
                      event.defaultPrevented ||
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    actions.openObject(object);
                  }}
                >
                  {inferredObjectLabel(object)}
                </a>
              </th>
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
