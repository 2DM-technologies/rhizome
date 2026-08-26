export interface paths {
  "/rnet/v0/vibes": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["listVibes"];
    put?: never;
    post: operations["createVibe"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/vibes/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getVibe"];
    put?: never;
    post?: never;
    delete: operations["deleteVibe"];
    options?: never;
    head?: never;
    patch: operations["updateVibe"];
    trace?: never;
  };
  "/rnet/v0/vibes/{id}/objects": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["listVibeMediaObjects"];
    put?: never;
    post: operations["addVibeMediaObjects"];
    delete: operations["removeVibeMediaObjects"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/vibes/{id}/push": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["pushVibe"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/vibes/{id}/pull": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["pullVibe"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/objects": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["createMediaObjects"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/objects/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getMediaObject"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/objects/{id}/user": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: operations["setMediaObjectUser"];
    trace?: never;
  };
  "/rnet/v0/objects/{id}/inferred": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations["setMediaObjectInferred"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/elements": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["createMediaElement"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/elements/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getMediaElement"];
    put?: never;
    post?: never;
    delete: operations["deleteMediaElement"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/elements/{id}/bytes": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getMediaElementBytes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/origins": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["createOriginArtifact"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/origins/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getOriginArtifact"];
    put?: never;
    post?: never;
    delete: operations["deleteOriginArtifact"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/origins/{id}/bytes": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getOriginArtifactBytes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/rnet/v0/operations/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getOperation"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    /**
     * Grant
     * @description The read-edge conformance unit: {subject, scope[]} attached to a Vibe. Scope semantics are store-enforced, always — never client-honor-system. Grants are owner-set; delegation is not specified. Stores MUST deny grants whose subject namespace they do not understand.
     */
    Grant: {
      /** @description Namespaced subject: id:rnet://id/{uuidv7} (a user), client:{name} (a registered application), public (anyone), or {x-namespace}:{...} (extension subject types). */
      subject: string;
      /** @description read: fetch Vibe/objects/elements — never origins, which are owner-only. write:user: mutate user blocks only. write:objects: create authored objects. write:inferred: write inferred entries directly, under a subject-namespaced task key. push: invoke push. pull: invoke a pull on already-configured sources. Grants are set by the owner alone — no scope delegates the ability to grant. */
      scope: ("read" | "write:user" | "write:objects" | "write:inferred" | "push" | "pull")[];
    };
    /**
     * IngestRecord
     * @description How an object came to be — the determinism disclosure. Consumers MAY gate on this record; the protocol guarantees the disclosure, not the trustworthiness.
     */
    IngestRecord: {
      /**
       * @description How this object was produced, named for what did the work. parser: a committed, versioned parser ran. generated_parser: an agent wrote a one-off parser, which ran — parser_hash pins it. agent: an agent extracted directly, writing no parser. authored: a person created the object in a client; nothing was parsed. Determinism runs parser > generated_parser > agent — generated code is hash-pinned and re-runnable, while freehand extraction is not. authored sits outside the ladder: nothing was derived.
       * @enum {unknown}
       */
      method: "parser" | "generated_parser" | "agent" | "authored";
      /** @description Skill identity + semver, when a corpus skill guided the run. */
      skill?: string | null;
      /** @description Model identity, when a model participated in parsing. */
      model?: string | null;
      /** @description Content hash of generated parser code. Regeneration is a new parser, new provenance. */
      parser_hash?: string | null;
      /** @description Whether re-running the same method against source.origins yields identical output (modulo timestamps). */
      reproducible: boolean;
    } & (unknown & unknown);
    /**
     * MediaElement
     * @description An immutable, UUIDv7-identified atomic content record: an owner, a content-addressed payload, and contextual metadata. Five kinds, closed set: an element kind exists iff a human consumes that thing directly. Every live element resolves — bytes is required; platform-locked content is referenced via the owning object's keys, never modelled as an element with a missing payload.
     */
    MediaElement: {
      /**
       * @description Protocol version this element record was written under.
       * @constant
       */
      rnet_schema: "0.1";
      /**
       * @description Consumption strategy. Closed set — new kinds only by protocol revision.
       * @enum {unknown}
       */
      kind: "text" | "image" | "audio" | "video" | "document";
      /** @description Immutable UUIDv7 record identity, independent of payload identity. */
      uri: string;
      /** @description Immutable owner identity assigned by the store at creation. */
      owner: string;
      /** @description SHA-256 identity of the payload bytes; not record identity or authority. */
      content_hash: string;
      /** @description IANA media type. mime is truth; kind is the consumption hint. */
      mime: string;
      /**
       * Format: uri
       * @description Retrievable payload location. Returned bytes must hash to content_hash.
       */
      bytes: string;
      byte_size?: number;
      /** Format: date-time */
      created_at?: string;
    } & {
      [key: string]: unknown;
    };
    /**
     * MediaObject
     * @description The core unit of meaning: properties plus zero or more MediaElements, carrying three property blocks with different mutation rights. Fields are values, elements are files — if you would query on it, it is a field; if you would open it, it is an element. Pure meaning-objects legitimately carry zero elements.
     */
    MediaObject: {
      /**
       * @description Protocol version this document conforms to.
       * @constant
       */
      rnet_schema: "0.1";
      /** @description UUIDv7-identified record. */
      uri: string;
      /** @description Immutable owner identity assigned by the store at creation. Ownership governs administration, not delegated access. */
      owner: string;
      /** @description Open vocabulary. The registered core vocabulary currently includes transaction and track; unregistered types such as post, photo, note, contact, event, book, article, and receipt remain legal. */
      type: string;
      /** @description Ordered MediaElement URIs. MAY be empty. */
      elements: string[];
      /** @description External global identifiers for cross-service joins: isrc, isbn, fitid, url, ean, etc. */
      keys?: {
        [key: string]: string;
      };
      /** @description Written by ingestion runtimes only. Immutable after ingest — re-ingestion creates a new revision, never edits in place. */
      source: {
        ingest: components["schemas"]["IngestRecord"];
        /** @description What this object was derived from — at least one, always. Either an origin artifact (rnet://origin/{uuid}) for ingested objects, or a client (rnet://client/{uuid}) for objects authored directly in an application. A filename string is not provenance. */
        origins: string[];
        /** Format: date-time */
        retrieved_at?: string;
        /** @description Facts the source format defines. Validated against the registered type vocabulary when one exists. */
        properties: Record<string, never>;
      } & unknown;
      /** @description Written by the owner via clients holding write:user. Freely mutable; revision-protected. */
      user?: {
        properties: Record<string, never>;
        /** Format: date-time */
        updated_at?: string;
      };
      /** @description A map keyed by writer and task: every key is {writer}:{task}. Memory scoped to this record — some entries are task output recomputed from source, others accumulated from corrections and agent observation and cannot be re-derived. A re-run replaces only its own key, and never a durable entry. Consumers MUST treat entries as advisory. */
      inferred?: {
        [key: string]: {
          model: string;
          /** Format: date-time */
          inferred_at?: string;
          /**
           * @description When true, a push task MUST NOT replace this entry. Durable entries hold understanding that accumulated rather than being computed from source — a user correction, a pattern an agent noticed across several objects. A task can never set this on its own output: durable means 'cannot be reproduced by re-running', and task output is by definition what re-running produces. Only agent runs and user-driven writes.
           * @default false
           */
          durable: boolean;
          properties: Record<string, never>;
          confidence?: number;
        };
      };
    } & {
      [key: string]: unknown;
    };
    /**
     * OriginArtifact
     * @description An immutable, UUIDv7-identified provenance record around a content-addressed payload. Ontologically inert: not media, has no kind, never appears in a Vibe's objects, never consumed by a model as content. Exists purely as ground truth so ingestion can always be re-run against original bytes.
     */
    OriginArtifact: {
      /**
       * @description Protocol version this origin record was written under.
       * @constant
       */
      rnet_schema: "0.1";
      /** @description Immutable UUIDv7 provenance-record identity, independent of payload identity. */
      uri: string;
      /** @description Immutable owner identity assigned by the store at creation. */
      owner: string;
      /** @description SHA-256 identity of the payload bytes; not record identity or authority. */
      content_hash: string;
      mime: string;
      /**
       * Format: uri
       * @description Retrievable payload location. Returned bytes must hash to content_hash.
       */
      bytes: string;
      byte_size?: number;
      /** @description Human-readable name, e.g. the original filename. */
      label?: string;
      /** Format: date-time */
      uploaded_at?: string;
    } & {
      [key: string]: unknown;
    };
    /**
     * track — source.properties vocabulary
     * @description Registered core type. Validates source.properties for objects with type "track". Normally a ZERO-element object: audio lives inside a streaming platform, so it is referenced through the object's keys (isrc as the cross-service join key; spotify_uri, apple_music_id, etc. as handoff locators) rather than modelled as an element. Identity and meaning live here in properties — title, artist, and album are fields because they are queried on. Album art, if stored, is an image element.
     */
    TrackProperties: {
      title: string;
      artist?: string;
      album?: string;
      duration_ms?: number;
      /** @description Release date, as precise as the source knows it: YYYY, YYYY-MM, or YYYY-MM-DD. */
      released?: string;
    } & {
      [key: string]: unknown;
    };
    /**
     * transaction — source.properties vocabulary
     * @description Registered core type. Validates source.properties for objects with type "transaction". Typically zero elements (fields are facts); authored attachments — memos, receipts — are the element case. Recommended keys: fitid (OFX transaction id), account_hash.
     */
    TransactionProperties: {
      /** @description Signed base-10 decimal string. Negative = outflow, positive = inflow, per OFX convention. Strings preserve exact monetary precision across implementations. */
      amount: string;
      /** @description ISO 4217 alpha code. */
      currency: string;
      /**
       * Format: date
       * @description Date the transaction posted.
       */
      posted_at?: string;
      /** @description The descriptor string as the source format carries it — a fact about the transaction, not authored content. */
      raw_description?: string;
    } & {
      [key: string]: unknown;
    };
    /**
     * Vibe
     * @description A dynamic, owned collection of MediaObjects, plus the state that makes it living: its pull configuration and its inferred block. Vibes contain object references, not copies. Vibes carry no source block — they are authored, not ingested; the omission is the ontology.
     */
    Vibe: {
      /**
       * @description Protocol version this document conforms to. Required, present from commit one.
       * @constant
       */
      rnet_schema: "0.1";
      uri: string;
      title: string;
      /** @description A stable rnet://id/{uuidv7} identity URI. Identity issuance and authentication are implementation-defined. */
      owner: string;
      /** @description Ordered MediaObject URIs — references, not copies. A URI may appear more than once; each occurrence is a distinct placement. Stores preserve this order, including duplicates, across paginated reads. */
      objects: string[];
      /** Format: date-time */
      created_at?: string;
      /** @description How the Vibe acquires new objects. */
      pull?: {
        enabled: boolean;
        /** @description Source identifiers, implementation-scoped (e.g. "skill:ofx@^0.3"). */
        sources?: string[];
        /** @enum {unknown} */
        policy?: "append_new" | "replace" | "suggest_only";
        /** Format: date-time */
        last_pulled_at?: string;
      };
      grants?: components["schemas"]["Grant"][];
      /** @description A map keyed by writer and task: every key is {writer}:{task}. Memory scoped to this record — some entries are task output recomputed from source, others accumulated from corrections and agent observation and cannot be re-derived. A re-run replaces only its own key, and never a durable entry. Consumers MUST treat entries as advisory. The store's summarize task conventionally writes summary and tags. */
      inferred?: {
        [key: string]: {
          model: string;
          /** Format: date-time */
          inferred_at?: string;
          /**
           * @description When true, a push task MUST NOT replace this entry. Durable entries hold understanding that accumulated rather than being computed from source — a user correction, a pattern an agent noticed across several objects — and re-running a task cannot reproduce them. Only agent runs and user-driven writes may set this; a task may never mark its own output durable, or refresh stops working.
           * @default false
           */
          durable: boolean;
          properties: Record<string, never>;
          confidence?: number;
        };
      };
    } & {
      [key: string]: unknown;
    };
    Problem: {
      /** Format: uri */
      type: string;
      title: string;
      status: number;
      detail: string;
      /** @enum {unknown} */
      code:
        | "authentication_required"
        | "grant_missing"
        | "ingest_nonconformant"
        | "internal_error"
        | "mime_required"
        | "not_found"
        | "not_implemented"
        | "payload_too_large"
        | "revision_conflict"
        | "schema_violation"
        | "writer_namespace_mismatch";
    } & {
      [key: string]: unknown;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  listVibes: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            vibes: components["schemas"]["Vibe"][];
          };
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  createVibe: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          title: string;
          /** @description How the Vibe acquires new objects. */
          pull?: {
            enabled: boolean;
            /** @description Source identifiers, implementation-scoped (e.g. "skill:ofx@^0.3"). */
            sources?: string[];
            /** @enum {unknown} */
            policy?: "append_new" | "replace" | "suggest_only";
            /** Format: date-time */
            last_pulled_at?: string;
          };
          grants?: components["schemas"]["Grant"][];
        };
      };
    };
    responses: {
      /** @description Successful response */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Vibe"];
        };
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  getVibe: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Vibe"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  deleteVibe: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description No content */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  updateVibe: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          title?: string;
          /** @description How the Vibe acquires new objects. */
          pull?: {
            enabled: boolean;
            /** @description Source identifiers, implementation-scoped (e.g. "skill:ofx@^0.3"). */
            sources?: string[];
            /** @enum {unknown} */
            policy?: "append_new" | "replace" | "suggest_only";
            /** Format: date-time */
            last_pulled_at?: string;
          };
          grants?: components["schemas"]["Grant"][];
        };
      };
    };
    responses: {
      /** @description Successful response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Vibe"];
        };
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  listVibeMediaObjects: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            mediaObjects: components["schemas"]["MediaObject"][];
          };
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  addVibeMediaObjects: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          objects: string[];
        };
      };
    };
    responses: {
      /** @description No content */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  removeVibeMediaObjects: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          objects: string[];
        };
      };
    };
    responses: {
      /** @description No content */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  pushVibe: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      501: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  pullVibe: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      501: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  createMediaObjects: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "multipart/form-data": {
          metadata: string;
        } & {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Successful response */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            mediaObjects: components["schemas"]["MediaObject"][];
          };
        };
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  getMediaObject: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful response */
      200: {
        headers: {
          /** @description Quoted `user` revision, for the `If-Match` of a subsequent write. */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["MediaObject"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  setMediaObjectUser: {
    parameters: {
      query?: never;
      header?: {
        "if-match"?: string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          properties: Record<string, never>;
        };
      };
    };
    responses: {
      /** @description Successful response */
      200: {
        headers: {
          /** @description Quoted `user` revision, for the `If-Match` of a subsequent write. */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["MediaObject"];
        };
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  setMediaObjectInferred: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          task: string;
          entry: {
            model: string;
            /** Format: date-time */
            inferred_at?: string;
            /**
             * @description When true, a push task MUST NOT replace this entry. Durable entries hold understanding that accumulated rather than being computed from source — a user correction, a pattern an agent noticed across several objects. A task can never set this on its own output: durable means 'cannot be reproduced by re-running', and task output is by definition what re-running produces. Only agent runs and user-driven writes.
             * @default false
             */
            durable?: boolean;
            properties: Record<string, never>;
            confidence?: number;
          };
        };
      };
    };
    responses: {
      /** @description Successful response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["MediaObject"];
        };
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  createMediaElement: {
    parameters: {
      query?: never;
      header: {
        "x-rnet-kind": "text" | "image" | "audio" | "video" | "document";
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "*/*": Blob;
      };
    };
    responses: {
      /** @description Successful response */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["MediaElement"];
        };
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  getMediaElement: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["MediaElement"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  deleteMediaElement: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description No content */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  getMediaElementBytes: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Binary content */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "*/*": Blob;
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  createOriginArtifact: {
    parameters: {
      query?: never;
      header?: {
        "x-rnet-label"?: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "*/*": Blob;
      };
    };
    responses: {
      /** @description Successful response */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["OriginArtifact"];
        };
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  getOriginArtifact: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["OriginArtifact"];
        };
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  deleteOriginArtifact: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description No content */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  getOriginArtifactBytes: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Binary content */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "*/*": Blob;
        };
      };
      /** @description Problem response */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
  getOperation: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            operation_id: string;
            /** @enum {unknown} */
            kind: "push" | "pull" | "agent";
            /** @enum {unknown} */
            status: "queued" | "running" | "done" | "failed" | "aborted";
            request: Record<string, never>;
            result: Record<string, never> | null;
            error: string | null;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            finished_at?: string;
          };
        };
      };
      /** @description Problem response */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
      /** @description Problem response */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["Problem"];
        };
      };
    };
  };
}
