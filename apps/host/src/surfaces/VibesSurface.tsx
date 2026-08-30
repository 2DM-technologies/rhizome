import { useState, type FormEvent } from "react";

import { useCreateVibe, useVibes } from "../queries/index.ts";
import { useSurfaceNavigation } from "../shell/focus.ts";
import { uuidOf } from "../api/uris.ts";
import { Button } from "../ui/index.ts";
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
          open({ kind: "vibe", uuid: uuidOf(vibe.uri) }, { keepCurrentOpen: true });
        },
      },
    );
  }

  return (
    <StoreSurface title="Vibes" detail="Every Vibe you own or have been granted">
      <form onSubmit={submit} className="mb-6 flex max-w-[36rem] items-center gap-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">New Vibe title</span>
          <input
            aria-label="New Vibe title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Name a new Vibe"
            maxLength={256}
            className="w-full rounded-pill border border-hairline bg-surface px-5 py-3 text-body text-primary outline-none placeholder:text-tertiary focus-visible:outline-2 focus-visible:outline-accent"
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
            <button
              type="button"
              onClick={() =>
                open({ kind: "vibe", uuid: uuidOf(vibe.uri) }, { keepCurrentOpen: true })
              }
              aria-label={`Open Vibe ${vibe.title}`}
              className="flex w-full items-baseline gap-3 border-b border-[rgba(20,20,26,0.06)] py-3 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-label text-primary">{vibe.title}</span>
              <span className="text-caption text-tertiary">{vibe.objects.length} objects</span>
            </button>
          </li>
        ))}
      </ul>
    </StoreSurface>
  );
}
