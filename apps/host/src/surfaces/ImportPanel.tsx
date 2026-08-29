import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

import {
  useConnectSimpleFin,
  useConfirmImportPreview,
  useCreateImportPreview,
  useCreateIngestionSource,
  useCreateOriginArtifact,
  useImportPreviewPayloadUrl,
  useOperation,
  usePullVibe,
} from "../queries/index.ts";
import { uuidOf } from "../api/uris.ts";
import { Button } from "../ui/index.ts";
import { Failed } from "./provisional.tsx";

type FileParser = "csv" | "ofx";

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

  return payload.data ? (
    <img src={payload.data} alt={`${title} preview`} className="size-full object-cover" />
  ) : (
    <span aria-hidden className="text-mono-label text-tertiary">
      {payload.isError ? "unavailable" : element.kind}
    </span>
  );
}

export function ImportPanel({
  vibeUuid,
  hasConfiguredSources,
}: {
  vibeUuid: string;
  hasConfiguredSources: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const simpleFinToken = useRef<HTMLInputElement>(null);
  const createOrigin = useCreateOriginArtifact();
  const connectSimpleFin = useConnectSimpleFin();
  const createSource = useCreateIngestionSource();
  const createPreview = useCreateImportPreview();
  const confirm = useConfirmImportPreview();
  const pull = usePullVibe();
  const [operationId, setOperationId] = useState<string>();
  const [operationMode, setOperationMode] = useState<"import" | "pull">("import");
  const [importKind, setImportKind] = useState<"arena" | "file" | "simplefin">("file");
  const [sourceLabel, setSourceLabel] = useState<string>();
  const [arenaChannelUrl, setArenaChannelUrl] = useState("");
  const [localError, setLocalError] = useState<string>();
  const [outcome, setOutcome] = useState<string>();
  const operation = useOperation(operationId, vibeUuid);
  const preview = previewResult(operation.data?.result);
  const pullSummary = pullResult(operation.data?.result);
  const operationInFlight = Boolean(
    operation.data && ["queued", "running"].includes(operation.data.status),
  );
  const busy =
    createOrigin.isPending ||
    connectSimpleFin.isPending ||
    createSource.isPending ||
    createPreview.isPending ||
    pull.isPending ||
    confirm.isPending ||
    operationInFlight;
  const malformedImportResult =
    operationMode === "import" && operation.data?.status === "done" && !preview;
  const malformedPullResult =
    operationMode === "pull" && operation.data?.status === "done" && !pullSummary;
  const arenaReview = operationMode === "import" && importKind === "arena";

  function resetMutationErrors() {
    createOrigin.reset();
    connectSimpleFin.reset();
    createSource.reset();
    createPreview.reset();
    confirm.reset();
    pull.reset();
  }

  function clearReview() {
    setOperationId(undefined);
    setSourceLabel(undefined);
    setLocalError(undefined);
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    resetMutationErrors();
    setOutcome(undefined);
    setOperationId(undefined);
    const parser = parserForFilename(file.name);
    if (!parser) {
      setSourceLabel(undefined);
      setLocalError("Choose a .csv, .qfx, or .ofx transaction export.");
      event.target.value = "";
      return;
    }
    setLocalError(undefined);
    setSourceLabel(file.name);
    setOperationMode("import");
    setImportKind("file");
    setOperationId(undefined);
    try {
      const origin = await createOrigin.mutateAsync({
        body: file,
        params: { header: { "x-rnet-label": file.name } },
      });
      const source = await createSource.mutateAsync({
        body: { origin: origin.uri, parser },
      });
      const staged = await createPreview.mutateAsync({
        params: { path: { id: vibeUuid } },
        body: { source: source.source },
      });
      setOperationId(staged.operation_id);
    } catch {
      // The mutation's typed store error is rendered below.
    } finally {
      event.target.value = "";
    }
  }

  async function exchangeSimpleFinToken() {
    const tokenInput = simpleFinToken.current;
    const setupToken = tokenInput?.value.trim();
    if (!tokenInput || !setupToken) {
      setLocalError("Paste a SimpleFIN setup token to connect an account.");
      return undefined;
    }
    try {
      return await connectSimpleFin.mutateAsync({ body: { setup_token: setupToken } });
    } finally {
      // Setup tokens are one-time secrets. Keep them out of React state and erase the DOM value
      // as soon as the exchange request settles, before creating a source or preview operation.
      tokenInput.value = "";
    }
  }

  async function connectSimpleFinAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMutationErrors();
    setOutcome(undefined);
    setOperationId(undefined);
    setSourceLabel(undefined);
    setLocalError(undefined);
    setOperationMode("import");
    setImportKind("simplefin");
    try {
      const credential = await exchangeSimpleFinToken();
      if (!credential) return;
      setSourceLabel("SimpleFIN");
      const source = await createSource.mutateAsync({
        body: { credential: credential.credential },
      });
      const staged = await createPreview.mutateAsync({
        params: { path: { id: vibeUuid } },
        body: { source: source.source },
      });
      setOperationId(staged.operation_id);
    } catch {
      // The mutation's typed store error is rendered below. The token is already cleared.
    }
  }

  async function importArenaChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMutationErrors();
    setOutcome(undefined);
    setOperationId(undefined);
    setSourceLabel(undefined);
    setLocalError(undefined);
    setOperationMode("import");
    setImportKind("arena");
    const channelUrl = arenaChannelUrl.trim();
    const channelSlug = arenaChannelSlug(channelUrl);
    if (!channelSlug) {
      setLocalError("Paste a public Are.na channel URL, like https://www.are.na/owner/channel.");
      return;
    }
    try {
      const source = await createSource.mutateAsync({
        body: { provider: "arena", channel_url: channelUrl },
      });
      setSourceLabel(`Are.na / ${channelSlug}`);
      const staged = await createPreview.mutateAsync({
        params: { path: { id: vibeUuid } },
        body: { source: source.source },
      });
      setOperationId(staged.operation_id);
    } catch {
      // The mutation's typed store error is rendered below.
    }
  }

  async function refreshSources() {
    resetMutationErrors();
    setOutcome(undefined);
    setLocalError(undefined);
    setSourceLabel(undefined);
    setOperationId(undefined);
    setOperationMode("pull");
    try {
      const operation = await pull.mutateAsync({
        params: { path: { id: vibeUuid } },
        body: {},
      });
      setOperationId(operation.operation_id);
    } catch {
      // The mutation's typed store error is rendered below.
    }
  }

  function cancelReview() {
    clearReview();
    confirm.reset();
    setOutcome(
      arenaReview
        ? "Review canceled. No Are.na blocks were imported."
        : "Review canceled. No transactions were imported.",
    );
  }

  function confirmReview() {
    if (!operationId || !preview?.verify.ok || operation.data?.status !== "done") return;
    const importedCount = preview.verify.candidateCount;
    const importedSource = sourceLabel;
    const importedArenaBlocks = arenaReview;
    confirm.mutate(
      { params: { path: { id: vibeUuid, operation_id: operationId } } },
      {
        onSuccess: () => {
          clearReview();
          setOutcome(
            importedArenaBlocks
              ? `Imported ${importedCount} Are.na ${importedCount === 1 ? "block" : "blocks"}${
                  importedSource ? ` from ${importedSource}` : ""
                }.`
              : `Imported ${importedCount} ${importedCount === 1 ? "transaction" : "transactions"}${
                  importedSource ? ` from ${importedSource}` : ""
                }.`,
          );
        },
      },
    );
  }

  return (
    <section className="flex max-w-[52rem] flex-col gap-4 rounded-card border border-hairline bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-label text-primary">Import into this Vibe</h2>
          <p className="mt-1 text-body text-secondary">
            Add a public Are.na channel, connect SimpleFIN, or choose a CSV/QFX export. Every source
            gets a review, and nothing derived is saved until you confirm.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {hasConfiguredSources ? (
            <Button variant="secondary" disabled={busy} onClick={() => void refreshSources()}>
              {operationMode === "pull" && busy ? "Refreshing…" : "Refresh sources"}
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
            {busy && operationMode === "import" && importKind === "file"
              ? "Preparing review…"
              : "Choose file"}
          </Button>
        </div>
        <input
          ref={input}
          className="sr-only"
          type="file"
          aria-label="Transaction export file"
          disabled={busy}
          accept=".csv,.qfx,.ofx,text/csv,application/x-ofx"
          onChange={(event) => void selectFile(event)}
        />
      </div>

      <section aria-labelledby="arena-import" className="border-t border-hairline pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="arena-import" className="text-label text-primary">
              Import an Are.na channel
            </h3>
            <p id="arena-channel-help" className="mt-1 text-caption text-secondary">
              Paste a public channel URL to stage its blocks and media for review.
            </p>
          </div>
          <form
            aria-label="Import Are.na channel"
            className="flex min-w-[20rem] flex-1 items-center gap-2"
            onSubmit={(event) => void importArenaChannel(event)}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">Are.na channel URL</span>
              <input
                type="url"
                name="arena-channel-url"
                aria-label="Are.na channel URL"
                aria-describedby="arena-channel-help"
                autoComplete="url"
                autoCapitalize="none"
                spellCheck={false}
                disabled={busy}
                placeholder="https://www.are.na/owner/channel"
                value={arenaChannelUrl}
                onChange={(event) => {
                  setArenaChannelUrl(event.target.value);
                  setLocalError(undefined);
                  createSource.reset();
                }}
                className="w-full rounded-pill border border-hairline bg-canvas px-5 py-3 text-caption text-primary outline-none placeholder:text-tertiary focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
            <Button type="submit" disabled={busy || !arenaChannelUrl.trim()}>
              {importKind === "arena" && busy ? "Preparing…" : "Review channel"}
            </Button>
          </form>
        </div>
      </section>

      <section aria-labelledby="simplefin-connect" className="border-t border-hairline pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="simplefin-connect" className="text-label text-primary">
              Connect SimpleFIN
            </h3>
            <p id="simplefin-token-help" className="mt-1 text-caption text-secondary">
              Exchange a one-time setup token, then review the fetched transactions before saving
              anything derived.
            </p>
            <a
              href="https://bridge.simplefin.org/simplefin/create"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-caption text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Create a setup token in SimpleFIN Bridge ↗
            </a>
          </div>
          <form
            aria-label="Connect SimpleFIN"
            className="flex min-w-[20rem] flex-1 items-center gap-2"
            onSubmit={(event) => void connectSimpleFinAccount(event)}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">SimpleFIN setup token</span>
              <input
                ref={simpleFinToken}
                type="password"
                name="simplefin-setup-token"
                aria-label="SimpleFIN setup token"
                aria-describedby="simplefin-token-help"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={busy}
                placeholder="Paste setup token"
                onChange={() => {
                  setLocalError(undefined);
                  connectSimpleFin.reset();
                }}
                className="w-full rounded-pill border border-hairline bg-canvas px-5 py-3 font-mono text-caption text-primary outline-none placeholder:text-tertiary focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
            <Button type="submit" disabled={busy}>
              {importKind === "simplefin" && busy ? "Connecting…" : "Connect"}
            </Button>
          </form>
        </div>
        {connectSimpleFin.isError ? (
          <div role="alert" className="mt-3">
            <Failed error={connectSimpleFin.error} />
          </div>
        ) : null}
      </section>

      {sourceLabel ? <span className="text-caption text-tertiary">{sourceLabel}</span> : null}
      {outcome ? (
        <span role="status" className="text-body text-secondary">
          {outcome}
        </span>
      ) : null}
      {operationInFlight ? (
        <span className="text-body text-tertiary">
          {operationMode === "pull"
            ? "Refreshing configured sources…"
            : importKind === "simplefin"
              ? "Fetching connected accounts and running VERIFY…"
              : importKind === "arena"
                ? "Fetching the Are.na channel and staging its media…"
                : "Parsing and running VERIFY…"}
        </span>
      ) : null}
      {operation.data?.status === "failed" ? (
        <span role="alert" className="text-body text-error">
          {operation.data.error ??
            (operationMode === "pull"
              ? "The source refresh failed."
              : "The import preview failed.")}
        </span>
      ) : null}
      {operation.data?.status === "aborted" ? (
        <span role="alert" className="text-body text-error">
          {operationMode === "pull" ? "The source refresh was aborted." : "The import was aborted."}
        </span>
      ) : null}
      {malformedImportResult ? (
        <span role="alert" className="text-body text-error">
          The completed import did not contain a valid review. Start the import again to retry.
        </span>
      ) : null}
      {malformedPullResult ? (
        <span role="alert" className="text-body text-error">
          The completed source refresh did not contain a valid summary.
        </span>
      ) : null}

      {preview ? (
        <div className="flex flex-col gap-4">
          <div aria-label="VERIFY reconciliation" className="rounded-card bg-canvas p-4">
            <span className="text-label text-primary">
              {preview.verify.ok
                ? arenaReview
                  ? `${preview.verify.candidateCount} Are.na ${
                      preview.verify.candidateCount === 1 ? "block" : "blocks"
                    } passed VERIFY`
                  : `${preview.verify.candidateCount} transactions passed VERIFY`
                : "VERIFY did not pass"}
            </span>
            <span className="mt-1 block text-caption text-secondary">
              {preview.verify.sourceRecordCount} {arenaReview ? "source blocks" : "source records"}{" "}
              → {preview.verify.candidateCount} candidates
            </span>
            <span className="mt-1 block text-caption text-secondary">
              {arenaReview
                ? `${preview.candidates.reduce((total, candidate) => total + candidate.elementCount, 0)} media elements staged`
                : Object.entries(preview.verify.totalsByCurrency).length > 0
                  ? Object.entries(preview.verify.totalsByCurrency)
                      .map(([currency, amount]) => `${currency} ${amount}`)
                      .join(" · ")
                  : "No monetary totals"}
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
          </div>
          <ul
            aria-label={arenaReview ? "Candidate Are.na blocks" : "Candidate transactions"}
            className="max-h-72 overflow-auto border-y border-hairline"
          >
            {preview.candidates.map((candidate) =>
              arenaReview ? (
                <li
                  key={candidate.uri}
                  data-import-candidate
                  className="flex items-center gap-4 border-b border-hairline py-3 last:border-b-0"
                >
                  <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-card bg-surface">
                    {candidate.elements[0]?.previewUrl && candidate.elements[0].kind === "image" ? (
                      <ImportPreviewImage
                        element={candidate.elements[0]}
                        operationId={operationId}
                        title={candidate.title}
                      />
                    ) : (
                      <span aria-hidden className="text-mono-label text-tertiary">
                        {candidate.elements[0]?.kind ?? "block"}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-primary">{candidate.title}</span>
                    <span className="mt-1 block text-caption text-tertiary">
                      {candidate.type} · {candidate.elementCount}{" "}
                      {candidate.elementCount === 1 ? "element" : "elements"}
                      {candidate.elements[0]
                        ? ` · ${candidate.elements[0].mime} · ${formatByteSize(
                            candidate.elements.reduce(
                              (total, element) => total + element.byteSize,
                              0,
                            ),
                          )}`
                        : ""}
                    </span>
                  </span>
                </li>
              ) : (
                <li
                  key={candidate.uri}
                  data-import-candidate
                  className="flex items-baseline gap-3 border-b border-hairline py-3 last:border-b-0"
                >
                  <span className="min-w-24 font-mono text-caption text-primary">
                    {String(candidate.amount ?? "")}
                  </span>
                  <span className="text-caption text-tertiary">
                    {String(candidate.currency ?? "")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body text-secondary">
                    {String(candidate.description ?? "Transaction")}
                  </span>
                  {candidate.postedAt ? (
                    <span className="shrink-0 text-caption text-tertiary">
                      {String(candidate.postedAt)}
                    </span>
                  ) : null}
                </li>
              ),
            )}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={cancelReview} disabled={confirm.isPending}>
              Cancel
            </Button>
            <Button
              disabled={confirm.isPending || !operationId || !preview.verify.ok}
              onClick={confirmReview}
            >
              {confirm.isPending ? "Importing…" : "Confirm import"}
            </Button>
          </div>
        </div>
      ) : null}

      {operationMode === "pull" && pullSummary && operation.data?.status === "done" ? (
        <div className="rounded-card bg-canvas p-4" role="status">
          <span className="text-label text-primary">
            Checked {pullSummary.candidate_count} transactions · added {pullSummary.added_count}
          </span>
          <span className="mt-1 block text-caption text-secondary">
            {pullSummary.duplicate_count} already known · {pullSummary.created_count} new records
          </span>
        </div>
      ) : null}

      {localError ? (
        <span role="alert" className="text-body text-error">
          {localError}
        </span>
      ) : null}
      {createOrigin.isError ? <Failed error={createOrigin.error} /> : null}
      {createSource.isError ? <Failed error={createSource.error} /> : null}
      {createPreview.isError ? <Failed error={createPreview.error} /> : null}
      {pull.isError ? <Failed error={pull.error} /> : null}
      {operation.isError ? <Failed error={operation.error} /> : null}
      {confirm.isError ? <Failed error={confirm.error} /> : null}
    </section>
  );
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

function parserForFilename(filename: string): FileParser | undefined {
  const extension = filename.toLowerCase().split(".").at(-1);
  if (extension === "csv") return "csv";
  if (extension === "qfx" || extension === "ofx") return "ofx";
  return undefined;
}

function arenaChannelSlug(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["are.na", "www.are.na"].includes(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      url.port
    ) {
      return undefined;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || url.search || url.hash) return undefined;
    return parts[1];
  } catch {
    return undefined;
  }
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
  if (Object.keys(totalsByCurrency).length !== Object.keys(rawTotals).length) {
    return undefined;
  }
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
