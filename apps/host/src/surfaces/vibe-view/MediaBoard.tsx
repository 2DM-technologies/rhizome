import { resolvePointer } from "@rhizome/store-contract";
import { MediaObjectEntry } from "../MediaObjectEntry.tsx";
import type { RowsProps } from "./types.ts";
import { displayValue, inferredObjectLabel } from "./utils.ts";

export function MediaBoard({ objects, config, ...actions }: RowsProps) {
  const caption = typeof config.caption_pointer === "string" ? config.caption_pointer : undefined;
  return (
    <ul className="grid grid-cols-1 gap-x-5 gap-y-12 sm:grid-cols-2 xl:grid-cols-3">
      {objects.map((object, index) => (
        <MediaObjectEntry
          key={`${object.uri}:${index}`}
          object={object}
          title={inferredObjectLabel(object)}
          {...(caption ? { caption: displayValue(resolvePointer(object, caption)) } : {})}
          openObject={() => actions.openObject(object)}
          removePending={actions.removePending}
          removeObject={actions.removeObject ? () => actions.removeObject?.(object) : undefined}
        />
      ))}
    </ul>
  );
}
