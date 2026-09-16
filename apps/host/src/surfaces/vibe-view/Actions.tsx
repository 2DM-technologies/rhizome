import type { MediaObject } from "@rnet/types";
import type { RowsProps } from "./types.ts";

export function Actions({
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
