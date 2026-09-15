import { resolvePointer } from "@rhizome/store-contract";
import { uuidOf } from "../../api/uris.ts";
import { pathOf } from "../../shell/surfaces.ts";
import { TextLink } from "../../ui/index.ts";
import { Actions } from "./Actions.tsx";
import type { RowsProps } from "./types.ts";
import { displayValue, inferredObjectLabel } from "./utils.ts";

export function SimpleList({ objects, config, ...actions }: RowsProps) {
  const pointer = typeof config.subtitle_pointer === "string" ? config.subtitle_pointer : undefined;
  return (
    <ul className="divide-y divide-hairline">
      {objects.map((object, index) => (
        <li key={`${object.uri}:${index}`} className="flex items-center justify-between gap-3 py-3">
          <TextLink
            href={pathOf({ kind: "object", uuid: uuidOf(object.uri) })}
            className="min-w-0 flex-1"
            size="label"
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
            <div className="text-label text-primary">{inferredObjectLabel(object)}</div>
            {pointer ? (
              <div className="text-caption text-tertiary">
                {displayValue(resolvePointer(object, pointer))}
              </div>
            ) : null}
          </TextLink>
          <Actions object={object} {...actions} />
        </li>
      ))}
    </ul>
  );
}
