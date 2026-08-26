import { useState } from "react";

import { isStoreError } from "../api/client.ts";
import { useMediaObject, useSetMediaObjectUser } from "../queries/index.ts";
import { Button, StatusChip } from "../ui/index.ts";
import { Failed, Pending, Provisional } from "./provisional.tsx";

/**
 * Provisional, but the write path is real: this is the only place the revision protocol runs
 * end to end. Read the object, get its `user` revision from the `ETag`, send that back as
 * `If-Match`, and handle the store rejecting the write because someone else got there first.
 *
 * To see the conflict: open this object in two windows, save in one, then save in the other.
 */
export function ObjectSurface({ uuid }: { uuid: string }) {
  const object = useMediaObject(uuid);
  const save = useSetMediaObjectUser(uuid);
  const [draft, setDraft] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const stored = object.data?.object.user?.properties ?? {};
  const text = draft ?? JSON.stringify(stored, null, 2);
  const conflicted = isStoreError(save.error) && save.error.code === "revision_conflict";

  function submit() {
    if (!object.data) return;
    let properties: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setParseError("User properties must be a JSON object.");
        return;
      }
      properties = parsed as Record<string, unknown>;
      setParseError(null);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Invalid JSON.");
      return;
    }
    save.mutate(
      { properties, ifMatch: object.data.userRev },
      // Drop the draft so the field re-syncs to whatever the store now holds.
      { onSuccess: () => setDraft(null) },
    );
  }

  return (
    <Provisional title={object.data?.object.type ?? "Object"} detail={object.data?.object.uri}>
      {object.isPending ? <Pending label="object" /> : null}
      {object.isError ? <Failed error={object.error} /> : null}

      {object.data ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="text-mono-label text-tertiary">
              USER REVISION {object.data.userRev}
            </span>
            {conflicted ? (
              <StatusChip status="error">someone else wrote — reload to see it</StatusChip>
            ) : null}
            {save.isSuccess && !draft ? <StatusChip status="success">saved</StatusChip> : null}
          </div>

          <textarea
            value={text}
            onChange={(event) => {
              setDraft(event.target.value);
              setParseError(null);
            }}
            spellCheck={false}
            rows={14}
            aria-label="User properties, as JSON"
            className="w-full rounded-sm border border-hairline bg-surface p-3 font-mono text-caption text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />

          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={save.isPending || draft === null}>
              {save.isPending ? "Saving…" : "Save user properties"}
            </Button>
            {draft !== null ? (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Discard
              </Button>
            ) : null}
            {parseError ? <span className="text-body text-error">{parseError}</span> : null}
            {save.isError && !conflicted ? <Failed error={save.error} /> : null}
          </div>
        </div>
      ) : null}
    </Provisional>
  );
}
