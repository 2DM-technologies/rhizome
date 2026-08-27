import { useState } from "react";

import { useMediaObject, useSetMediaObjectUser } from "../queries/index.ts";
import { Button, StatusChip } from "../ui/index.ts";
import { Failed, Pending, Provisional } from "./provisional.tsx";

/** Provisional editor backed by the real last-write-wins `user` write path. */
export function ObjectSurface({ uuid }: { uuid: string }) {
  const object = useMediaObject(uuid);
  const save = useSetMediaObjectUser();
  const [draft, setDraft] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const stored = object.data?.user?.properties ?? {};
  const text = draft ?? JSON.stringify(stored, null, 2);

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
      {
        params: { path: { id: uuid } },
        body: { properties },
      },
      // Drop the draft so the field re-syncs to whatever the store now holds.
      { onSuccess: () => setDraft(null) },
    );
  }

  return (
    <Provisional title={object.data?.type ?? "Object"} detail={object.data?.uri}>
      {object.isPending ? <Pending label="object" /> : null}
      {object.isError ? <Failed error={object.error} /> : null}

      {object.data ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
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
            {save.isError ? <Failed error={save.error} /> : null}
          </div>
        </div>
      ) : null}
    </Provisional>
  );
}
