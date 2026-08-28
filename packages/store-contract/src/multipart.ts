import type {
  ClientCreateMediaObjectsRequest,
  CreateMediaObjectsRequest,
  OwnerCreateMediaObjectsRequest,
} from "./index.ts";

export type CreateMediaObjectsMultipartInput<Metadata extends CreateMediaObjectsRequest> =
  Metadata & {
    readonly uploads?: Readonly<Record<string, Blob>>;
  };

function makeCreateMediaObjectsFormData<Metadata extends CreateMediaObjectsRequest>(
  input: CreateMediaObjectsMultipartInput<Metadata>,
): FormData {
  const { uploads = {}, ...metadata } = input;
  if (Object.hasOwn(uploads, "metadata")) {
    throw new TypeError('The upload key "metadata" is reserved for request metadata');
  }

  const formData = new FormData();
  formData.set("metadata", JSON.stringify(metadata));
  for (const [key, upload] of Object.entries(uploads)) formData.set(key, upload);
  return formData;
}

/** Encode an owner-authored atomic media-object creation request. */
export function makeOwnerCreateMediaObjectsFormData(
  input: CreateMediaObjectsMultipartInput<OwnerCreateMediaObjectsRequest>,
): FormData {
  return makeCreateMediaObjectsFormData(input);
}

/** Encode a dMachine-authored atomic media-object creation request. */
export function makeClientCreateMediaObjectsFormData(
  input: CreateMediaObjectsMultipartInput<ClientCreateMediaObjectsRequest>,
): FormData {
  return makeCreateMediaObjectsFormData(input);
}
