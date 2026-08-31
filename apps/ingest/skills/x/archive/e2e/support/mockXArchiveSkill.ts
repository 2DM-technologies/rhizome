import type { MediaElement, MediaObject } from "@rnet/types";

import {
  OWNER_ID,
  type MockSourceSkillAdapter,
  type MockStagedElement,
} from "../../../../../../host/e2e/support/mockStore.ts";
import { compileXPostCandidates } from "../../../tweet-candidates.ts";
import { X_ARCHIVE_CAPTURE_MIME } from "../../contracts.ts";
import { xArchiveSourceSkillManifest } from "../../manifest.ts";
import { xArchiveParser } from "../../parser.ts";

export const X_ARCHIVE_SOURCE_ID = "0198f2a1-1a01-7a01-8a01-000000000001";
export const X_ARCHIVE_OPERATION_ID = "0198f2a1-1b01-7b01-8b01-000000000001";
export const X_ARCHIVE_ORIGIN_ID = "0198f2a1-1c01-7c01-8c01-000000000001";

export const mockXArchiveSkill = {
  manifest: xArchiveSourceSkillManifest,
  operationId: X_ARCHIVE_OPERATION_ID,
  sourceId: X_ARCHIVE_SOURCE_ID,
  originUpload: {
    contentHash: `sha256:${"9".repeat(64)}`,
    id: X_ARCHIVE_ORIGIN_ID,
    accepts: ({ label, mime }) =>
      label.endsWith("-selection.zip") && mime === X_ARCHIVE_CAPTURE_MIME,
  },
  async stage({ origin }) {
    const selection = await xArchiveParser.parse(origin.payload);
    const bundle = await compileXPostCandidates(selection, xArchiveSourceSkillManifest.limits);
    const candidates: MediaObject[] = [];
    const elements: MockStagedElement[] = [];
    for (const [candidateIndex, candidate] of bundle.candidates.entries()) {
      const objectId = indexedUuid("0198f2a1-1d01-7d01-8d01-000000000000", candidateIndex);
      const objectUri = `rnet://object/${objectId}` as const;
      const references: MediaObject["elements"] = [];
      for (const [elementIndex, element] of candidate.elements.entries()) {
        const elementId = indexedUuid(
          "0198f2a1-1e01-7e01-8e01-000000000000",
          candidateIndex * 10 + elementIndex,
        );
        const uri = `rnet://element/${elementId}` as const;
        const document = {
          rnet_schema: "0.1",
          kind: element.kind,
          uri,
          owner: `rnet://id/${OWNER_ID}`,
          content_hash: element.contentHash,
          mime: element.mime,
          bytes: `http://127.0.0.1/rnet/v0/elements/${elementId}/bytes`,
          byte_size: element.byteSize,
          created_at: selection.retrievedAt ?? "2026-08-22T12:00:00.000Z",
        } satisfies MediaElement;
        references.push({
          uri,
          role: element.role,
          ...(element.alt ? { alt: element.alt } : {}),
        });
        elements.push({
          document,
          object_uri: objectUri,
          preview_url: `/rnet/v0/operations/${X_ARCHIVE_OPERATION_ID}/elements/${elementId}/bytes`,
          role: element.role,
          ...(element.alt ? { alt: element.alt } : {}),
          payload: Buffer.from(element.bytes),
        });
      }
      candidates.push({
        rnet_schema: "0.1",
        uri: objectUri,
        owner: `rnet://id/${OWNER_ID}`,
        type: candidate.type,
        elements: references,
        keys: candidate.keys,
        source: {
          ingest: { method: "parser", reproducible: true, skill: "x-posts@test" },
          origins: [origin.document.uri],
          properties: candidate.sourceProperties,
        },
      });
    }
    return {
      candidates,
      destination: bundle.destination,
      elements,
      verification: {
        ...bundle.verify,
        checks: [...bundle.verify.checks],
        totals_by_currency: {},
      },
    };
  },
} satisfies MockSourceSkillAdapter;

function indexedUuid(namespace: string, index: number): string {
  return `${namespace.slice(0, -12)}${String(index + 1).padStart(12, "0")}`;
}
