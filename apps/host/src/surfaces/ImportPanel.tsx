import type { SourceActionRequired, SourceSkillManifest } from "@rhizome/store-contract";
import { useMemo, useRef, useState, type FormEvent, type Ref } from "react";

import { isStoreError } from "../api/client.ts";
import { uuidOf } from "../api/uris.ts";
import {
  useConnectSourceCredential,
  useConfirmImportPreview,
  useCreateImportPreview,
  useCreateIngestionSource,
  useCreateOriginArtifact,
  useForgetOperation,
  useImportPreviewPayloadUrl,
  useOperation,
  usePullVibe,
  useSourceSkills,
} from "../queries/index.ts";
import {
  Button,
  Callout,
  Card,
  ElementPreview,
  EntityRow,
  FilePicker,
  InlineError,
  StatusChip,
  TextInput,
  TextLink,
} from "../ui/index.ts";
import { Failed } from "./provisional.tsx";
import { sourceActionRequired } from "./sourceActionRequired.ts";

type SourceSkillInputField = SourceSkillManifest["input_fields"][number];

interface CandidateSummary {
  uri: string;
  type: string;
  title: string;
  elementCount: number;
  elements: PreviewElementSummary[];
  amount?: unknown;
  currency?: unknown;
  description?: unknown;
  postedAt?: unknown;
}

interface PreviewElementSummary {
  uri: string;
  objectUri: string;
  role?: "title" | "content" | "preview";
  kind: string;
  mime: string;
  byteSize: number;
  contentHash: string;
  previewUrl?: string;
}

interface VerifyCheckSummary {
  name: string;
  ok: boolean;
  detail: string;
}

interface ImportPreview {
  verify: {
    ok: boolean;
    sourceRecordCount: number;
    candidateCount: number;
    totalsByCurrency: Record<string, string>;
    checks: VerifyCheckSummary[];
  };
  candidates: CandidateSummary[];
}

export function ImportPanel({
  vibeUuid,
  configuredSources,
}: {
  vibeUuid: string;
  configuredSources: readonly string[];
}) {
  const sourceForm = useRef<HTMLFormElement>(null);
  const sourceSkills = useSourceSkills();
  const createOrigin = useCreateOriginArtifact();
  const connectCredential = useConnectSourceCredential();
  const createSource = useCreateIngestionSource();
  const createPreview = useCreateImportPreview();
  const confirm = useConfirmImportPreview();
  const pull = usePullVibe();
  const forgetOperation = useForgetOperation();
  const [skillSearch, setSkillSearch] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<string>();
  const [operationId, setOperationId] = useState<string>();
  const [operationMode, setOperationMode] = useState<"import" | "pull">("import");
  const [activeSkillId, setActiveSkillId] = useState<string>();
  const [sourceLabel, setSourceLabel] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const [outcome, setOutcome] = useState<string>();

  const importSkills = useMemo(
    () =>
      (sourceSkills.data ?? []).filter((skill) => skill.review_actions.includes("review_import")),
    [sourceSkills.data],
  );
  const selectedSkill =
    importSkills.find((skill) => skill.skill_id === selectedSkillId) ?? importSkills[0];
  const skillChoices = useMemo(() => {
    const query = skillSearch.trim().toLocaleLowerCase();
    if (!query) return importSkills;
    const matches = importSkills.filter((skill) =>
      `${skill.label} ${skill.description} ${skill.skill_id}`.toLocaleLowerCase().includes(query),
    );
    return selectedSkill && !matches.some((skill) => skill.skill_id === selectedSkill.skill_id)
      ? [selectedSkill, ...matches]
      : matches;
  }, [importSkills, selectedSkill, skillSearch]);

  const operation = useOperation(operationId, vibeUuid);
  const preview = previewResult(operation.data?.result);
  const pullSummary = pullResult(operation.data?.result);
  const operationInFlight = Boolean(
    operation.data && ["queued", "running"].includes(operation.data.status),
  );
  const busy =
    createOrigin.isPending ||
    connectCredential.isPending ||
    createSource.isPending ||
    createPreview.isPending ||
    pull.isPending ||
    confirm.isPending ||
    operationInFlight;
  const malformedImportResult =
    operationMode === "import" && operation.data?.status === "done" && !preview;
  const malformedPullResult =
    operationMode === "pull" && operation.data?.status === "done" && !pullSummary;
  const failedPullResult =
    operationMode === "pull" && operation.data?.status === "failed"
      ? operation.data.result
      : undefined;
  const requiredAction = sourceActionRequired(pull.error, failedPullResult, configuredSources);
  const activeSkill = importSkills.find((skill) => skill.skill_id === activeSkillId);

  function resetMutationErrors() {
    createOrigin.reset();
    connectCredential.reset();
    createSource.reset();
    createPreview.reset();
    confirm.reset();
    pull.reset();
  }

  function clearReview() {
    setOperationId(undefined);
    setSourceLabel(undefined);
    setActiveSkillId(undefined);
    setLocalError(undefined);
  }

  function selectSkill(skillId: string) {
    clearSecretFields(sourceForm.current, selectedSkill);
    clearReview();
    resetMutationErrors();
    setSelectedSkillId(skillId);
    setOutcome(undefined);
  }

  async function stageSelectedSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const manifest = selectedSkill;
    if (!manifest) return;
    resetMutationErrors();
    setOutcome(undefined);
    setOperationId(undefined);
    setSourceLabel(undefined);
    setLocalError(undefined);
    setOperationMode("import");
    setActiveSkillId(manifest.skill_id);

    const form = event.currentTarget;
    try {
      // Extract the form synchronously so the secret-bearing FormData is not retained across any
      // network await. Credential fields are scrubbed again as soon as the connection request
      // settles below.
      const sourceInput = sourceInputForManifest(manifest, new FormData(form));
      const source = await createSourceForManifest(manifest, sourceInput, {
        connectCredential: async (skillId, body) => {
          try {
            return await connectCredential.mutateAsync({
              params: { path: { skill_id: skillId } },
              body,
            });
          } catch (error) {
            // This mutation is reset immediately to evict its secret-bearing variables, so retain
            // only the server's safe display message outside TanStack state.
            throw new CredentialRequestError(errorMessage(error));
          } finally {
            clearSecretFields(form, manifest);
            scrubRecord(body);
            // TanStack mutations retain variables for inspection. Detach this observer as soon as
            // the one request containing a source secret settles, before source creation or
            // preview staging begins.
            connectCredential.reset();
          }
        },
        createOrigin: (file) =>
          createOrigin.mutateAsync({
            body: file,
            params: { header: { "x-rnet-label": file.name } },
          }),
        createSource: (body) => createSource.mutateAsync({ body }),
      });
      setSourceLabel(source.displayLabel ?? manifest.label);
      const staged = await createPreview.mutateAsync({
        params: { path: { id: vibeUuid } },
        body: { source: source.source },
      });
      setOperationId(staged.operation_id);
    } catch (error) {
      if (error instanceof ManifestInputError || error instanceof CredentialRequestError) {
        setLocalError(error.message);
      }
    } finally {
      // Covers local validation failures that happen before a credential request starts.
      clearSecretFields(form, manifest);
      connectCredential.reset();
    }
  }

  async function refreshSources() {
    resetMutationErrors();
    setOutcome(undefined);
    setLocalError(undefined);
    setSourceLabel(undefined);
    setActiveSkillId(undefined);
    setOperationId(undefined);
    setOperationMode("pull");
    try {
      const next = await pull.mutateAsync({
        params: { path: { id: vibeUuid } },
        body: {},
      });
      setOperationId(next.operation_id);
    } catch {
      // The mutation's typed store error is rendered below.
    }
  }

  async function reviewRequiredAction(action: SourceActionRequired) {
    const actionOperationId = operationId;
    resetMutationErrors();
    setOutcome(undefined);
    setLocalError(undefined);
    setOperationId(undefined);
    setOperationMode("import");
    setActiveSkillId(undefined);
    setSourceLabel(action.title);
    try {
      const staged = await createPreview.mutateAsync({
        params: { path: { id: vibeUuid } },
        body: { source: action.source, continuation_token: action.continuation_token },
      });
      setOperationId(staged.operation_id);
    } catch (error) {
      // The preview mutation is reset below to evict the continuation bearer, so retain only the
      // safe server message needed by the UI.
      setLocalError(errorMessage(error));
    } finally {
      createPreview.reset();
      if (actionOperationId) forgetOperation(actionOperationId);
    }
  }

  function cancelReview() {
    clearReview();
    confirm.reset();
    setOutcome("Review canceled. Nothing was imported.");
  }

  function confirmReview() {
    if (!operationId || !preview?.verify.ok || operation.data?.status !== "done") return;
    const importedCount = preview.verify.candidateCount;
    const importedSource = sourceLabel;
    const importedObjects = candidateCountLabel(preview.candidates, importedCount);
    confirm.mutate(
      { params: { path: { id: vibeUuid, operation_id: operationId } } },
      {
        onSuccess: () => {
          clearReview();
          setOutcome(
            `Imported ${importedCount} ${importedObjects}${
              importedSource ? ` from ${importedSource}` : ""
            }.`,
          );
        },
      },
    );
  }

  return (
    <Card as="section" className="flex max-w-[52rem] flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-label text-primary">Import into this Vibe</h2>
          <p className="mt-1 text-body text-secondary">
            Choose an installed source, review what it found, then explicitly confirm before
            anything derived is saved.
          </p>
        </div>
        {configuredSources.length > 0 ? (
          <Button variant="secondary" disabled={busy} onClick={() => void refreshSources()}>
            {operationMode === "pull" && busy ? "Refreshing…" : "Refresh sources"}
          </Button>
        ) : null}
      </div>

      <section aria-labelledby="source-skill-heading" className="border-t border-hairline pt-4">
        <h3 id="source-skill-heading" className="text-label text-primary">
          Source
        </h3>
        {sourceSkills.isPending ? (
          <span className="mt-2 block text-caption text-tertiary">Loading installed sources…</span>
        ) : sourceSkills.isError ? (
          <div className="mt-2">
            <Failed error={sourceSkills.error} />
          </div>
        ) : importSkills.length === 0 ? (
          <span role="status" className="mt-2 block text-caption text-secondary">
            No installed source supports reviewed import.
          </span>
        ) : (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <label>
                <span className="sr-only">Search import sources</span>
                <TextInput
                  type="search"
                  aria-label="Search import sources"
                  value={skillSearch}
                  onChange={(event) => setSkillSearch(event.target.value)}
                  placeholder="Search installed sources"
                  tone="canvas"
                  typography="caption"
                />
              </label>
              <label>
                <span className="sr-only">Import source</span>
                <select
                  aria-label="Import source"
                  value={selectedSkill?.skill_id ?? ""}
                  onChange={(event) => selectSkill(event.target.value)}
                  className="w-full rounded-pill border border-hairline bg-canvas px-5 py-3 text-caption text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {skillChoices.map((skill) => (
                    <option key={skill.skill_id} value={skill.skill_id}>
                      {skill.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedSkill ? (
              <SourceSkillForm
                key={selectedSkill.skill_id}
                ref={sourceForm}
                manifest={selectedSkill}
                busy={busy}
                active={activeSkillId === selectedSkill.skill_id && operationInFlight}
                onSubmit={stageSelectedSource}
                onInput={() => {
                  setLocalError(undefined);
                  connectCredential.reset();
                  createOrigin.reset();
                  createSource.reset();
                }}
              />
            ) : null}
          </>
        )}
      </section>

      {sourceLabel && selectedSkill?.source_kind !== "file" ? (
        <span className="text-caption text-tertiary">{sourceLabel}</span>
      ) : null}
      {outcome ? (
        <span role="status" className="text-body text-secondary">
          {outcome}
        </span>
      ) : null}
      {operationInFlight ? (
        <span className="text-body text-tertiary">
          {operationMode === "pull"
            ? "Refreshing configured sources…"
            : `Running ${activeSkill?.label ?? "source"} and VERIFY…`}
        </span>
      ) : null}
      {operation.data?.status === "failed" ? (
        <InlineError>
          {operation.data.error ??
            (operationMode === "pull"
              ? "The source refresh failed."
              : "The import preview failed.")}
        </InlineError>
      ) : null}
      {operation.data?.status === "aborted" ? (
        <InlineError>
          {operationMode === "pull" ? "The source refresh was aborted." : "The import was aborted."}
        </InlineError>
      ) : null}
      {requiredAction ? (
        <Callout className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-label text-primary">{requiredAction.title}</span>
            <span className="mt-1 block text-caption text-secondary">{requiredAction.detail}</span>
          </div>
          <Button disabled={busy} onClick={() => void reviewRequiredAction(requiredAction)}>
            Review import
          </Button>
        </Callout>
      ) : null}
      {malformedImportResult ? (
        <InlineError>
          The completed import did not contain a valid review. Start the import again to retry.
        </InlineError>
      ) : null}
      {malformedPullResult ? (
        <InlineError>The completed source refresh did not contain a valid summary.</InlineError>
      ) : null}

      {preview ? (
        <ImportReview
          preview={preview}
          operationId={operationId}
          confirming={confirm.isPending}
          onCancel={cancelReview}
          onConfirm={confirmReview}
        />
      ) : null}

      {operationMode === "pull" && pullSummary && operation.data?.status === "done" ? (
        <Callout role="status" tone="success">
          <span className="text-label text-primary">
            Checked {pullSummary.candidate_count} candidates · added {pullSummary.added_count}
          </span>
          <span className="mt-1 block text-caption text-secondary">
            {pullSummary.duplicate_count} already known · {pullSummary.created_count} new objects
          </span>
        </Callout>
      ) : null}

      {localError ? <InlineError>{localError}</InlineError> : null}
      {createOrigin.isError ? <Failed error={createOrigin.error} /> : null}
      {createSource.isError ? <Failed error={createSource.error} /> : null}
      {createPreview.isError ? <Failed error={createPreview.error} /> : null}
      {pull.isError && !requiredAction ? <Failed error={pull.error} /> : null}
      {operation.isError ? <Failed error={operation.error} /> : null}
      {confirm.isError ? <Failed error={confirm.error} /> : null}
    </Card>
  );
}

function SourceSkillForm({
  ref,
  manifest,
  busy,
  active,
  onSubmit,
  onInput,
}: {
  ref: Ref<HTMLFormElement>;
  manifest: SourceSkillManifest;
  busy: boolean;
  active: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onInput: () => void;
}) {
  return (
    <form ref={ref} className="mt-4 flex flex-col gap-3" onSubmit={onSubmit} onInput={onInput}>
      <div>
        <span className="text-label text-primary">{manifest.label}</span>
        <span className="mt-1 block text-caption text-secondary">{manifest.description}</span>
      </div>
      {manifest.input_fields.map((field) => (
        <ManifestField
          key={`${field.target}:${field.name}`}
          manifest={manifest}
          field={field}
          disabled={busy}
        />
      ))}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {active ? "Preparing review…" : `Review ${manifest.label}`}
        </Button>
      </div>
    </form>
  );
}

function ManifestField({
  manifest,
  field,
  disabled,
}: {
  manifest: SourceSkillManifest;
  field: SourceSkillInputField;
  disabled: boolean;
}) {
  const id = `source-${manifest.skill_id}-${field.target}-${field.name}`;
  const helpId = field.help_text ? `${id}-help` : undefined;
  const shared = {
    id,
    name: fieldFormName(field),
    // `required` means the boolean field must exist, not that its value must be true. A required
    // unchecked checkbox is false; an optional unchecked checkbox is omitted for server defaults.
    required: field.control === "checkbox" ? undefined : field.required,
    disabled,
    "aria-describedby": helpId,
  };
  return (
    <div className="block">
      <label htmlFor={id} className="text-caption text-primary">
        {field.label}
      </label>
      {field.control === "checkbox" ? (
        <input {...shared} type="checkbox" className="ml-3 align-middle accent-accent" />
      ) : field.control === "select" ? (
        <select
          {...shared}
          defaultValue=""
          className="mt-1 w-full rounded-pill border border-hairline bg-canvas px-5 py-3 text-caption text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent"
        >
          <option value="" disabled={field.required}>
            {field.placeholder ?? `Choose ${field.label.toLocaleLowerCase()}`}
          </option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.control === "file" ? (
        <FilePicker
          {...shared}
          accept={field.accept?.join(",")}
          buttonLabel={`Choose ${field.label.toLocaleLowerCase()}`}
          className="mt-1"
        />
      ) : (
        <TextInput
          {...shared}
          type={field.secret ? "password" : field.control === "url" ? "url" : "text"}
          placeholder={field.placeholder}
          autoComplete={field.secret ? "off" : field.control === "url" ? "url" : "off"}
          autoCapitalize="none"
          spellCheck={false}
          tone="canvas"
          typography={field.secret ? "mono" : "caption"}
          className="mt-1"
        />
      )}
      {field.help_text ? (
        <span id={helpId} className="mt-1 block text-caption text-tertiary">
          {field.help_text}
        </span>
      ) : null}
      {field.help_url ? (
        <TextLink
          href={field.help_url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block"
        >
          Learn more ↗
        </TextLink>
      ) : null}
    </div>
  );
}

function ImportReview({
  preview,
  operationId,
  confirming,
  onCancel,
  onConfirm,
}: {
  preview: ImportPreview;
  operationId: string | undefined;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const elementCount = preview.candidates.reduce(
    (total, candidate) => total + candidate.elementCount,
    0,
  );
  const totals = Object.entries(preview.verify.totalsByCurrency);
  return (
    <div className="flex flex-col gap-4">
      <Callout aria-label="VERIFY reconciliation" tone={preview.verify.ok ? "success" : "error"}>
        <StatusChip status={preview.verify.ok ? "success" : "error"}>
          {preview.verify.ok ? "passed" : "failed"}
        </StatusChip>
        <span className="text-label text-primary">
          {preview.verify.ok
            ? `${preview.verify.candidateCount} ${candidateCountLabel(
                preview.candidates,
                preview.verify.candidateCount,
              )} passed VERIFY`
            : "VERIFY did not pass"}
        </span>
        <span className="mt-1 block text-caption text-secondary">
          {preview.verify.sourceRecordCount} source records → {preview.verify.candidateCount}{" "}
          candidates
        </span>
        <span className="mt-1 block text-caption text-secondary">
          {totals.length > 0
            ? totals.map(([currency, amount]) => `${currency} ${amount}`).join(" · ")
            : elementCount > 0
              ? `${elementCount} ${elementCount === 1 ? "element" : "elements"} staged`
              : "No aggregate totals"}
        </span>
        <ul aria-label="VERIFY checks" className="mt-3 flex flex-col gap-2">
          {preview.verify.checks.map((check) => (
            <li
              key={check.name}
              data-verify-check={check.name}
              className="flex items-start gap-2 text-caption text-secondary"
            >
              <span aria-hidden className={check.ok ? "text-success" : "text-error"}>
                {check.ok ? "✓" : "×"}
              </span>
              <span>{check.detail}</span>
            </li>
          ))}
        </ul>
      </Callout>
      <ul
        aria-label="Candidate media objects"
        className="max-h-72 overflow-auto border-y border-hairline"
      >
        {preview.candidates.map((candidate) => (
          <CandidateReview key={candidate.uri} candidate={candidate} operationId={operationId} />
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={confirming}>
          Cancel
        </Button>
        <Button disabled={confirming || !operationId || !preview.verify.ok} onClick={onConfirm}>
          {confirming ? "Importing…" : "Confirm import"}
        </Button>
      </div>
    </div>
  );
}

function CandidateReview({
  candidate,
  operationId,
}: {
  candidate: CandidateSummary;
  operationId: string | undefined;
}) {
  if (candidate.type === "transaction") {
    return (
      <EntityRow
        as="li"
        data-import-candidate
        align="baseline"
        className="last:border-b-0"
        leading={
          <span className="flex min-w-32 items-baseline gap-3">
            <span className="min-w-24 font-mono text-caption text-primary">
              {String(candidate.amount ?? "")}
            </span>
            <span className="text-caption text-tertiary">{String(candidate.currency ?? "")}</span>
          </span>
        }
        title={String(candidate.description ?? candidate.title)}
        titleClassName="text-body text-secondary"
        meta={candidate.postedAt ? String(candidate.postedAt) : undefined}
      />
    );
  }

  const primaryElement = primaryPreviewElement(candidate.elements);
  const metadataElement = primaryElement ?? candidate.elements[0];
  return (
    <EntityRow
      as="li"
      data-import-candidate
      className="last:border-b-0"
      leading={
        <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-card bg-surface">
          {primaryElement?.previewUrl && primaryElement.kind === "image" ? (
            <ImportPreviewImage
              element={primaryElement}
              operationId={operationId}
              title={candidate.title}
            />
          ) : (
            <span aria-hidden className="text-mono-label text-tertiary">
              {primaryElement?.kind ?? "object"}
            </span>
          )}
        </span>
      }
      title={candidate.title}
      titleClassName="text-body text-primary"
      subtitle={`${candidate.type} · ${candidate.elementCount} ${
        candidate.elementCount === 1 ? "element" : "elements"
      }${
        metadataElement
          ? ` · ${metadataElement.mime} · ${formatByteSize(
              candidate.elements.reduce((total, element) => total + element.byteSize, 0),
            )}`
          : ""
      }`}
      subtitleClassName="text-caption text-tertiary"
    />
  );
}

function ImportPreviewImage({
  element,
  operationId,
  title,
}: {
  element: PreviewElementSummary;
  operationId: string | undefined;
  title: string;
}) {
  const payload = useImportPreviewPayloadUrl(
    element.previewUrl ? operationId : undefined,
    element.previewUrl ? uuidOf(element.uri) : undefined,
  );
  return (
    <ElementPreview
      title={`${title} preview`}
      kind={element.kind}
      mime={element.mime}
      src={payload.data}
      variant="thumbnail"
      isPending={payload.isPending}
      isError={payload.isError}
      loadingLabel={element.kind}
      errorLabel="unavailable"
    />
  );
}

interface ManifestSourceDependencies {
  connectCredential(
    skillId: string,
    body: Record<string, unknown>,
  ): Promise<{ credential: string }>;
  createOrigin(file: File): Promise<{ uri: string }>;
  createSource(body: CreateSourceBody): Promise<{ source: string }>;
}

type CreateSourceBody =
  | { origin: string; skill_id: string }
  | { credential: string; config?: Record<string, unknown> }
  | { skill_id: string; config: Record<string, unknown> };

class ManifestInputError extends Error {}

class CredentialRequestError extends Error {}

type ManifestSourceInput =
  | { kind: "file"; file: File }
  | {
      kind: "credentialed_remote";
      connection: Record<string, unknown>;
      source: Record<string, unknown>;
    }
  | { kind: "public_remote"; source: Record<string, unknown> };

function errorMessage(error: unknown): string {
  if (isStoreError(error)) return error.detail;
  return error instanceof Error ? error.message : "The source could not be connected.";
}

async function createSourceForManifest(
  manifest: SourceSkillManifest,
  input: ManifestSourceInput,
  dependencies: ManifestSourceDependencies,
): Promise<{ source: string; displayLabel?: string }> {
  if (input.kind === "file") {
    const origin = await dependencies.createOrigin(input.file);
    const created = await dependencies.createSource({
      origin: origin.uri,
      skill_id: manifest.skill_id,
    });
    return { ...created, displayLabel: input.file.name };
  }
  if (input.kind === "credentialed_remote") {
    let credential: { credential: string };
    try {
      credential = await dependencies.connectCredential(manifest.skill_id, input.connection);
    } finally {
      // Do not keep the source secret reachable while the credential token is exchanged for an
      // ingestion source. The dependency also clears any transport-library mutation state.
      scrubRecord(input.connection);
    }
    return dependencies.createSource({
      credential: credential.credential,
      ...(Object.keys(input.source).length > 0 ? { config: input.source } : {}),
    });
  }
  return dependencies.createSource({ skill_id: manifest.skill_id, config: input.source });
}

function sourceInputForManifest(
  manifest: SourceSkillManifest,
  formData: FormData,
): ManifestSourceInput {
  const source = fieldsForTarget(manifest, formData, "source");
  if (manifest.source_kind === "file") {
    const fileField = manifest.input_fields.find((field) => field.control === "file");
    const file = fileField ? formData.get(fieldFormName(fileField)) : undefined;
    if (!(file instanceof File) || file.size === 0) {
      throw new ManifestInputError(`Choose ${fileField?.label.toLocaleLowerCase() ?? "a file"}.`);
    }
    if (fileField?.accept?.length && !fileMatchesAccept(file, fileField.accept)) {
      throw new ManifestInputError(`Choose a file accepted by ${manifest.label}.`);
    }
    return { kind: "file", file };
  }
  if (manifest.source_kind === "credentialed_remote") {
    return {
      kind: "credentialed_remote",
      connection: fieldsForTarget(manifest, formData, "connection"),
      source,
    };
  }
  return { kind: "public_remote", source };
}

function fieldsForTarget(
  manifest: SourceSkillManifest,
  formData: FormData,
  target: SourceSkillInputField["target"],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of manifest.input_fields) {
    if (field.target !== target || field.control === "file") continue;
    if (field.secret && target === "source") {
      throw new ManifestInputError("An installed source attempted to persist a secret field.");
    }
    if (field.control === "checkbox") {
      const checked = formData.has(fieldFormName(field));
      if (field.required || checked) result[field.name] = checked;
      continue;
    }
    const value = formData.get(fieldFormName(field));
    if (typeof value !== "string") {
      if (field.required) throw new ManifestInputError(`${field.label} is required.`);
      continue;
    }
    if (value === "" && !field.required) continue;
    if (value === "") throw new ManifestInputError(`${field.label} is required.`);
    result[field.name] = value;
  }
  return result;
}

function clearSecretFields(
  form: HTMLFormElement | null,
  manifest: SourceSkillManifest | undefined,
): void {
  if (!form || !manifest) return;
  for (const field of manifest.input_fields) {
    if (!field.secret) continue;
    const element = form.elements.namedItem(fieldFormName(field));
    if (element instanceof HTMLInputElement) element.value = "";
  }
}

function scrubRecord(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) record[key] = undefined;
}

function fieldFormName(field: SourceSkillInputField): string {
  return `${field.target}:${field.name}`;
}

function fileMatchesAccept(file: File, accepted: readonly string[]): boolean {
  const filename = file.name.toLocaleLowerCase();
  const mime = file.type.toLocaleLowerCase();
  return accepted.some((rawToken) => {
    const token = rawToken.trim().toLocaleLowerCase();
    if (token.startsWith(".")) return filename.endsWith(token);
    if (token.endsWith("/*")) return mime.startsWith(token.slice(0, -1));
    return token.includes("/") && mime === token;
  });
}

function candidateCountLabel(candidates: readonly CandidateSummary[], count: number): string {
  const transactionOnly =
    candidates.length > 0 && candidates.every(({ type }) => type === "transaction");
  if (transactionOnly) return count === 1 ? "transaction" : "transactions";
  return count === 1 ? "object" : "objects";
}

function pullResult(value: unknown):
  | {
      candidate_count: number;
      added_count: number;
      duplicate_count: number;
      created_count: number;
    }
  | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  if (
    typeof result.candidate_count !== "number" ||
    typeof result.added_count !== "number" ||
    typeof result.duplicate_count !== "number" ||
    typeof result.created_count !== "number"
  ) {
    return undefined;
  }
  return {
    candidate_count: result.candidate_count,
    added_count: result.added_count,
    duplicate_count: result.duplicate_count,
    created_count: result.created_count,
  };
}

function primaryPreviewElement(
  elements: PreviewElementSummary[],
): PreviewElementSummary | undefined {
  return (
    elements.find((element) => element.role === "content") ??
    elements.find((element) => element.role === "preview") ??
    elements.find((element) => element.role !== "title")
  );
}

function formatByteSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

function previewResult(value: unknown): ImportPreview | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.candidates) || !result.verify || typeof result.verify !== "object") {
    return undefined;
  }
  const verify = result.verify as Record<string, unknown>;
  if (
    typeof verify.ok !== "boolean" ||
    typeof verify.source_record_count !== "number" ||
    typeof verify.candidate_count !== "number" ||
    !Array.isArray(verify.checks)
  ) {
    return undefined;
  }
  const rawTotals =
    verify.totals_by_currency && typeof verify.totals_by_currency === "object"
      ? (verify.totals_by_currency as Record<string, unknown>)
      : {};
  const totalsByCurrency = Object.fromEntries(
    Object.entries(rawTotals).flatMap(([currency, amount]) =>
      typeof amount === "string" ? [[currency, amount]] : [],
    ),
  );
  if (Object.keys(totalsByCurrency).length !== Object.keys(rawTotals).length) return undefined;
  const checks = verify.checks.flatMap((check): VerifyCheckSummary[] => {
    if (!check || typeof check !== "object") return [];
    const candidate = check as Record<string, unknown>;
    return typeof candidate.name === "string" &&
      typeof candidate.ok === "boolean" &&
      typeof candidate.detail === "string"
      ? [{ name: candidate.name, ok: candidate.ok, detail: candidate.detail }]
      : [];
  });
  if (checks.length !== verify.checks.length) return undefined;
  const resultElements = Array.isArray(result.elements)
    ? result.elements.flatMap(parsePreviewElement)
    : [];
  const candidates: CandidateSummary[] = [];
  for (const candidate of result.candidates) {
    if (!candidate || typeof candidate !== "object") return undefined;
    const document = candidate as Record<string, unknown>;
    const source = document.source as Record<string, unknown> | undefined;
    const properties = source?.properties as Record<string, unknown> | undefined;
    if (typeof document.uri !== "string" || !properties) return undefined;
    const elementUris = Array.isArray(document.elements)
      ? document.elements.filter((element): element is string => typeof element === "string")
      : [];
    const inlineElements = Array.isArray(document.elements)
      ? document.elements.flatMap(parsePreviewElement)
      : [];
    const elements = [...resultElements, ...inlineElements].filter(
      (element, index, all) =>
        (element.objectUri === document.uri || elementUris.includes(element.uri)) &&
        all.findIndex((candidate) => candidate.uri === element.uri) === index,
    );
    const type = typeof document.type === "string" ? document.type : "media-object";
    const title = firstNonemptyString(
      properties.title,
      properties.name,
      properties.raw_description,
      properties.description,
    );
    candidates.push({
      uri: document.uri,
      type,
      title: title ?? (type === "transaction" ? "Transaction" : `Untitled ${type}`),
      elementCount: Math.max(elementUris.length, elements.length),
      elements,
      amount: properties.amount,
      currency: properties.currency,
      description: properties.raw_description,
      postedAt: properties.posted_at,
    });
  }
  if (candidates.length !== verify.candidate_count) return undefined;
  return {
    verify: {
      ok: verify.ok,
      sourceRecordCount: verify.source_record_count,
      candidateCount: verify.candidate_count,
      totalsByCurrency,
      checks,
    },
    candidates,
  };
}

function parsePreviewElement(value: unknown): PreviewElementSummary[] {
  if (!value || typeof value !== "object") return [];
  const element = value as Record<string, unknown>;
  if (
    typeof element.uri !== "string" ||
    typeof element.object_uri !== "string" ||
    typeof element.kind !== "string" ||
    typeof element.mime !== "string" ||
    typeof element.byte_size !== "number" ||
    typeof element.content_hash !== "string"
  ) {
    return [];
  }
  return [
    {
      uri: element.uri,
      objectUri: element.object_uri,
      kind: element.kind,
      mime: element.mime,
      byteSize: element.byte_size,
      contentHash: element.content_hash,
      ...(element.role === "title" || element.role === "content" || element.role === "preview"
        ? { role: element.role }
        : {}),
      ...(typeof element.preview_url === "string" ? { previewUrl: element.preview_url } : {}),
    },
  ];
}

function firstNonemptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}
