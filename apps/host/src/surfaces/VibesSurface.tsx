import { useState, type FormEvent } from "react";

import { useCreateVibe, useVibes } from "../queries/index.ts";
import { useSurfaceNavigation } from "../shell/focus.ts";
import { uuidOf } from "../api/uris.ts";
import { Button, EntityRow, TextInput } from "../ui/index.ts";
import { Failed, Pending, StoreSurface } from "./provisional.tsx";

export function VibesSurface() {
  const vibes = useVibes();
  const create = useCreateVibe();
  const { open } = useSurfaceNavigation();
  const [title, setTitle] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    create.mutate(
      { body: { title: nextTitle } },
      {
        onSuccess: (vibe) => {
          setTitle("");
          open({ kind: "vibe", uuid: uuidOf(vibe.uri) });
        },
      },
    );
  }

  return (
    <StoreSurface title="Vibes" detail="Every Vibe you own or have been granted">
      <form onSubmit={submit} className="mb-6 flex max-w-[36rem] items-center gap-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">New Vibe title</span>
          <TextInput
            aria-label="New Vibe title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Name a new Vibe"
            maxLength={256}
          />
        </label>
        <Button type="submit" disabled={!title.trim() || create.isPending}>
          {create.isPending ? "Creating…" : "Create Vibe"}
        </Button>
      </form>

      {create.isError ? (
        <div className="mb-4">
          <Failed error={create.error} />
        </div>
      ) : null}
      {vibes.isPending ? <Pending label="vibes" /> : null}
      {vibes.isError ? <Failed error={vibes.error} /> : null}
      {vibes.data?.length === 0 ? (
        <span className="text-body text-tertiary">No Vibes yet.</span>
      ) : null}
      <ul className="flex flex-col">
        {vibes.data?.map((vibe) => (
          <li key={vibe.uri}>
            <EntityRow
              align="baseline"
              title={vibe.title}
              meta={`${vibe.objects.length} objects`}
              selectLabel={`Open Vibe ${vibe.title}`}
              onSelect={() => open({ kind: "vibe", uuid: uuidOf(vibe.uri) })}
            />
          </li>
        ))}
      </ul>
    </StoreSurface>
  );
}
