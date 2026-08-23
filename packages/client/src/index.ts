import type {
  Grant,
  MediaElement,
  MediaObject,
  OriginArtifact,
  Vibe,
} from "@rnet/types";

export interface Page<T> {
  items: T[];
  next?: string;
}

export interface CreateVibeInput {
  title: string;
  pull?: Vibe["pull"];
  grants?: Grant[];
}

export interface CreateObjectsInput {
  vibe?: string;
  objects: MediaObject[];
}

export interface UploadElementInput {
  bytes: Blob | ArrayBuffer | Uint8Array;
  kind: MediaElement["kind"];
  mime: string;
  vibe?: string;
}

export interface UploadOriginInput {
  bytes: Blob | ArrayBuffer | Uint8Array;
  mime: string;
  label?: string;
}

export interface VersionedObject {
  value: MediaObject;
  userRev: number;
}

export class RhizomeProblem extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message: string,
    readonly detail?: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RhizomeProblem";
  }
}

export interface RhizomeClientOptions {
  baseUrl: string;
  token?: string | (() => string | Promise<string | undefined>);
  fetch?: typeof globalThis.fetch;
}

export class RhizomeClient {
  readonly #baseUrl: string;
  readonly #token?: RhizomeClientOptions["token"];
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: RhizomeClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<{ value: T; response: Response }> {
    const token = typeof this.#token === "function" ? await this.#token() : this.#token;
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !(init.body instanceof Blob) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await this.#fetch(`${this.#baseUrl}/rnet/v0${path}`, { ...init, headers });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const { status, type, title, detail, ...extensions } = body;
      throw new RhizomeProblem(
        response.status,
        typeof type === "string" ? type : "about:blank",
        typeof title === "string" ? title : response.statusText,
        typeof detail === "string" ? detail : undefined,
        extensions,
      );
    }

    return { value: (await response.json()) as T, response };
  }

  async listVibes(): Promise<Vibe[]> {
    return (await this.#request<Page<Vibe>>("/vibes")).value.items;
  }

  async createVibe(input: CreateVibeInput): Promise<Vibe> {
    return (await this.#request<Vibe>("/vibes", { method: "POST", body: JSON.stringify(input) })).value;
  }

  async getVibe(uriOrId: string): Promise<Vibe> {
    return (await this.#request<Vibe>(`/vibes/${encodeURIComponent(idFromUri(uriOrId))}`)).value;
  }

  async getVibeObjects(uriOrId: string): Promise<MediaObject[]> {
    const page = await this.#request<Page<MediaObject>>(
      `/vibes/${encodeURIComponent(idFromUri(uriOrId))}/objects?expand=full`,
    );
    return page.value.items;
  }

  async createObjects(input: CreateObjectsInput): Promise<MediaObject[]> {
    return (await this.#request<{ items: MediaObject[] }>("/objects", {
      method: "POST",
      body: JSON.stringify(input),
    })).value.items;
  }

  async getObject(uriOrId: string): Promise<VersionedObject> {
    const { value, response } = await this.#request<MediaObject>(
      `/objects/${encodeURIComponent(idFromUri(uriOrId))}`,
    );
    return { value, userRev: Number(response.headers.get("ETag")?.replaceAll('"', "") ?? 0) };
  }

  async setUser(uriOrId: string, properties: Record<string, unknown>, ifMatch: number): Promise<VersionedObject> {
    const { value, response } = await this.#request<MediaObject>(
      `/objects/${encodeURIComponent(idFromUri(uriOrId))}/user`,
      {
        method: "PATCH",
        headers: { "If-Match": String(ifMatch) },
        body: JSON.stringify({ properties }),
      },
    );
    return { value, userRev: Number(response.headers.get("ETag")?.replaceAll('"', "") ?? 0) };
  }

  async uploadElement(input: UploadElementInput): Promise<MediaElement> {
    const bytes = input.bytes instanceof Blob ? input.bytes : new Blob([ownedBuffer(input.bytes)]);
    const headers: Record<string, string> = { "Content-Type": input.mime, "X-Rnet-Kind": input.kind };
    if (input.vibe) headers["X-Rnet-Vibe"] = input.vibe;
    return (await this.#request<MediaElement>("/elements", {
      method: "POST",
      headers,
      body: bytes,
    })).value;
  }

  async uploadOrigin(input: UploadOriginInput): Promise<OriginArtifact> {
    const bytes = input.bytes instanceof Blob ? input.bytes : new Blob([ownedBuffer(input.bytes)]);
    const headers: Record<string, string> = { "Content-Type": input.mime };
    if (input.label) headers["X-Rnet-Label"] = input.label;
    return (await this.#request<OriginArtifact>("/origins", { method: "POST", headers, body: bytes })).value;
  }
}

export function idFromUri(uriOrId: string): string {
  const slash = uriOrId.lastIndexOf("/");
  return slash >= 0 ? uriOrId.slice(slash + 1) : uriOrId;
}

function ownedBuffer(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  return value.slice().buffer as ArrayBuffer;
}
