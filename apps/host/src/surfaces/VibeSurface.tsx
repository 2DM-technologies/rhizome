import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import {
  useDeleteVibe,
  useRemoveVibeObjects,
  useUpdateVibe,
  useVibe,
  useVibeObjects,
} from "../queries/index.ts";
import { mediaObjectDisplayName } from "../mediaObjectDisplayName.ts";
import { useSession } from "../session/session.ts";
import { useSurfaceNavigation } from "../shell/focus.ts";
import { uuidOf } from "../api/uris.ts";
import { Button, IconButton } from "../ui/index.ts";
import { CheckIcon, EditIcon } from "../ui/icons.tsx";
import { surfaceId } from "../shell/surfaces.ts";
import { Failed, Pending, StoreSurface } from "./provisional.tsx";
import { ImportPanel } from "./ImportPanel.tsx";
import { useSourceConnectionReturn } from "./sourceConnectionReturn.ts";
import { InferredVibeView, resolveVibeView } from "./InferredVibeView.tsx";
import { PushControl } from "./PushControl.tsx";
import { MediaObjectEntry } from "./MediaObjectEntry.tsx";
import { VibeOverview } from "./VibeOverview.tsx";
import { useTaskInferenceStatus } from "../queries/taskInferenceStatus.ts";
import { PUSH_TASKS } from "../api/generated/push-tasks.ts";
import { ProceduralVibeOrb } from "../orb/ProceduralVibeOrb.tsx";
import { orbVisualForVibe } from "../orb/vibeRecipe.ts";
import { VibeActionsMenu } from "./VibeActionsMenu.tsx";

export function VibeSurface({ uuid }: { uuid: string }) {
  const sourceConnectionReturn = useSourceConnectionReturn({
    kind: "existing_vibe",
    vibeUuid: uuid,
  });
  const vibe = useVibe(uuid);
  const objects = useVibeObjects(uuid);
  useTaskInferenceStatus(
    uuid,
    { level: "object", task: PUSH_TASKS.object["display-name"].name },
    Boolean(vibe.data),
  );
  const summaryStatus = useTaskInferenceStatus(
    uuid,
    { level: "vibe", task: PUSH_TASKS.vibe.summarize.name },
    Boolean(vibe.data),
  );
  const viewStatus = useTaskInferenceStatus(
    uuid,
    { level: "vibe", task: PUSH_TASKS.vibe["vibe-view"].name },
    Boolean(vibe.data),
  );
  const orbStatus = useTaskInferenceStatus(
    uuid,
    { level: "vibe", task: PUSH_TASKS.vibe["vibe-orb"].name },
    Boolean(vibe.data),
  );
  const update = useUpdateVibe();
  const remove = useRemoveVibeObjects();
  const deleteVibe = useDeleteVibe();
  const session = useSession();
  const { open, close } = useSurfaceNavigation();
  const importPanelId = useId();
  const [importExpanded, setImportExpanded] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const title = titleDraft ?? vibe.data?.title ?? "";
  const isOwner = vibe.data?.owner === session.data?.user.id;
  const orbVisual = useMemo(
    () => (vibe.data ? orbVisualForVibe(vibe.data) : undefined),
    [vibe.data],
  );

  useEffect(() => {
    if (sourceConnectionReturn.attemptId || sourceConnectionReturn.failureMessage) {
      setImportExpanded(true);
    }
  }, [sourceConnectionReturn.attemptId, sourceConnectionReturn.failureMessage]);

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || !vibe.data || !isOwner || titleDraft === null || update.isPending) return;
    if (nextTitle === vibe.data.title) {
      setTitleDraft(null);
      return;
    }
    update.mutate(
      { params: { path: { id: uuid } }, body: { title: nextTitle } },
      { onSuccess: () => setTitleDraft(null) },
    );
  }

  function confirmVibeDeletion() {
    deleteVibe.mutate(
      { params: { path: { id: uuid } } },
      { onSuccess: () => close(surfaceId({ kind: "vibe", uuid })) },
    );
  }

  return (
    <StoreSurface
      title={vibe.data?.title ?? "Vibe"}
      headerDivider
      heading={
        vibe.data && orbVisual ? (
          <div className="flex min-w-0 items-center gap-4">
            <ProceduralVibeOrb
              recipe={orbVisual.recipe}
              motion="continuous"
              loading={orbVisual.loading}
              size={72}
              label={`${vibe.data.title} Vibe orb`}
            />
            {isOwner ? (
              <form onSubmit={rename} className="group/title relative min-w-0">
                {titleDraft === null ? (
                  <>
                    <h1 className="text-heading text-primary">{vibe.data.title}</h1>
                    <IconButton
                      aria-label="Edit Vibe title"
                      title="Edit title"
                      size="sm"
                      tone="ghost"
                      className="absolute -left-8 top-0 opacity-0 group-hover/title:opacity-100 group-focus-within/title:opacity-100 [@media(hover:none)]:opacity-100"
                      onClick={(event) => {
                        // This DOM button becomes the submit control when editing starts.
                        event.preventDefault();
                        update.reset();
                        setTitleDraft(vibe.data!.title);
                      }}
                    >
                      <EditIcon />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <input
                      autoFocus
                      aria-label="Vibe title"
                      className="block w-full min-w-0 rounded-none border-0 bg-transparent p-0 text-heading text-primary outline-none"
                      value={title}
                      maxLength={256}
                      readOnly={update.isPending}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && !update.isPending) {
                          event.preventDefault();
                          setTitleDraft(null);
                          update.reset();
                        }
                      }}
                    />
                    <IconButton
                      type="submit"
                      aria-label="Save Vibe title"
                      title="Save title (Enter)"
                      size="sm"
                      tone="ghost"
                      className="absolute -left-8 top-0"
                      disabled={!title.trim() || update.isPending}
                    >
                      <CheckIcon />
                    </IconButton>
                  </>
                )}
              </form>
            ) : (
              <h1 className="text-heading text-primary">{vibe.data.title}</h1>
            )}
          </div>
        ) : undefined
      }
      detail={vibe.data?.uri}
      actions={
        vibe.data ? (
          <div className="flex items-center gap-2">
            {isOwner && confirmDelete ? (
              <>
                <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  aria-label="Confirm delete Vibe"
                  onClick={confirmVibeDeletion}
                  disabled={deleteVibe.isPending}
                >
                  {deleteVibe.isPending ? "Deleting…" : "Confirm delete"}
                </Button>
              </>
            ) : null}
            <VibeActionsMenu
              uuid={uuid}
              onDelete={isOwner && !confirmDelete ? () => setConfirmDelete(true) : undefined}
            />
          </div>
        ) : null
      }
    >
      {vibe.isPending ? <Pending label="vibe" /> : null}
      {vibe.isError ? <Failed error={vibe.error} /> : null}
      {deleteVibe.isError ? <Failed error={deleteVibe.error} /> : null}
      {update.isError ? <Failed error={update.error} /> : null}

      {vibe.data ? (
        <VibeOverview
          vibe={vibe.data}
          status={summaryStatus.data}
          viewStatus={viewStatus.data}
          orbStatus={orbStatus.data}
          inferredError={viewStatus.isError ? "Could not load Vibe view task status." : undefined}
          error={summaryStatus.isError ? "Could not load summary task status." : undefined}
        >
          {isOwner ? (
            <div className="flex flex-col gap-4">
              {remove.isError ? <Failed error={remove.error} /> : null}
              <Button
                variant="secondary"
                className="self-start"
                aria-expanded={importExpanded}
                aria-controls={importPanelId}
                onClick={() => setImportExpanded((expanded) => !expanded)}
              >
                Import into this Vibe
              </Button>
              <div id={importPanelId} hidden={!importExpanded}>
                <ImportPanel
                  vibeUuid={uuid}
                  configuredSources={vibe.data.pull?.enabled ? (vibe.data.pull.sources ?? []) : []}
                  sourceConnectionReturn={sourceConnectionReturn}
                />
              </div>
            </div>
          ) : null}
        </VibeOverview>
      ) : null}

      {vibe.data && objects.data ? (
        <InferredVibeView
          objects={objects.data}
          vibe={vibe.data}
          openObject={(object) => open({ kind: "object", uuid: uuidOf(object.uri) })}
          removePending={remove.isPending}
          removeObject={
            isOwner
              ? (object) =>
                  remove.mutate({
                    params: { path: { id: uuid } },
                    body: { objects: [object.uri] },
                  })
              : undefined
          }
        />
      ) : null}

      {objects.isPending ? <Pending label="objects" /> : null}
      {objects.isError ? <Failed error={objects.error} /> : null}
      {objects.data?.length === 0 ? (
        <span className="text-body text-tertiary">This Vibe has no objects yet.</span>
      ) : null}
      {objects.data?.length && (!vibe.data || !resolveVibeView(vibe.data, objects.data)) ? (
        <section aria-labelledby="media-objects-heading" className="mb-8 flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="media-objects-heading" className="text-label text-primary">
              Objects
            </h2>
            <span className="text-caption text-tertiary">
              {objects.data.length} {objects.data.length === 1 ? "object" : "objects"}
            </span>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {objects.data.map((object, index) => (
              <MediaObjectEntry
                key={`${object.uri}:${index}`}
                title={mediaObjectDisplayName(object)}
                object={object}
                openObject={() => open({ kind: "object", uuid: uuidOf(object.uri) })}
                removePending={remove.isPending}
                removeObject={
                  isOwner
                    ? () =>
                        remove.mutate({
                          params: { path: { id: uuid } },
                          body: { objects: [object.uri] },
                        })
                    : undefined
                }
              />
            ))}
          </ul>
        </section>
      ) : null}

      {vibe.data && objects.data && isOwner ? (
        <PushControl objects={objects.data} vibeUuid={uuid} />
      ) : null}
    </StoreSurface>
  );
}
