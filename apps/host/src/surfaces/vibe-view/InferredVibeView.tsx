import { storeTaskKey } from "@rhizome/store-contract";
import { PUSH_TASKS } from "../../api/generated/push-tasks.ts";
import { TweetFeed } from "../TweetFeed.tsx";
import { DataTable } from "./DataTable.tsx";
import { MediaBoard } from "./MediaBoard.tsx";
import { SimpleList } from "./SimpleList.tsx";
import type { Config, Props } from "./types.ts";
import { properties, resolveVibeView } from "./utils.ts";

export function InferredVibeView({ objects, vibe, ...actions }: Props) {
  const entry = properties(vibe.inferred?.[storeTaskKey(PUSH_TASKS.vibe["vibe-view"].name)]);
  const view = resolveVibeView(vibe, objects);
  const raw = entry?.config;
  const config =
    view === "tweetfeed"
      ? {}
      : raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Config)
        : undefined;
  return (
    <>
      {view && config ? (
        <section aria-label="Inferred Vibe view" data-vibe-view={view} className="mb-8">
          {view === "tweetfeed" ? <TweetFeed objects={objects} {...actions} /> : null}
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
