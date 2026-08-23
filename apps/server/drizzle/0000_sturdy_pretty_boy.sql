CREATE TABLE "elements" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"owner_uuid" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"rnet_schema" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"created_for_vibe" uuid,
	"tombstoned_at" timestamp with time zone,
	CONSTRAINT "elements_kind_check" CHECK ("elements"."kind" IN ('text', 'image', 'audio', 'video', 'document'))
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"vibe_uuid" uuid NOT NULL,
	"subject" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "grants_vibe_uuid_subject_pk" PRIMARY KEY("vibe_uuid","subject")
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_uuid" uuid,
	"trust" text DEFAULT 'standard' NOT NULL,
	"generated" boolean DEFAULT false NOT NULL,
	"code_hash" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_trust_check" CHECK ("machines"."trust" IN ('system', 'standard'))
);
--> statement-breakpoint
CREATE TABLE "meter" (
	"operation_uuid" uuid PRIMARY KEY NOT NULL,
	"payer" text NOT NULL,
	"model" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"turns" integer,
	"duration_ms" integer,
	"usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"abort_reason" text,
	"breakdown" jsonb
);
--> statement-breakpoint
CREATE TABLE "object_elements" (
	"object_uuid" uuid NOT NULL,
	"element_uuid" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "object_elements_object_uuid_position_pk" PRIMARY KEY("object_uuid","position")
);
--> statement-breakpoint
CREATE TABLE "object_origins" (
	"object_uuid" uuid NOT NULL,
	"artifact_uuid" uuid,
	"machine_uuid" uuid,
	CONSTRAINT "object_origins_exactly_one_check" CHECK (num_nonnulls("object_origins"."artifact_uuid", "object_origins"."machine_uuid") = 1)
);
--> statement-breakpoint
CREATE TABLE "object_revisions" (
	"object_uuid" uuid NOT NULL,
	"block" text NOT NULL,
	"rev" integer NOT NULL,
	"snapshot" jsonb,
	"actor" text NOT NULL,
	"operation_uuid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_revisions_object_uuid_block_rev_pk" PRIMARY KEY("object_uuid","block","rev"),
	CONSTRAINT "object_revisions_block_check" CHECK ("object_revisions"."block" IN ('source', 'user', 'inferred'))
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"owner_uuid" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_for_vibe" uuid,
	"type" text NOT NULL,
	"keys" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" jsonb NOT NULL,
	"source_rev" integer DEFAULT 1 NOT NULL,
	"user" jsonb,
	"user_rev" integer DEFAULT 0 NOT NULL,
	"inferred" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rnet_schema" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"invoked_by" text NOT NULL,
	"vibe_uuid" uuid,
	"request" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "operations_kind_check" CHECK ("operations"."kind" IN ('push', 'pull', 'agent')),
	CONSTRAINT "operations_status_check" CHECK ("operations"."status" IN ('queued', 'running', 'done', 'failed', 'aborted'))
);
--> statement-breakpoint
CREATE TABLE "origins" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"owner_uuid" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"mime" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"label" text,
	"rnet_schema" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tombstoned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"handle" text NOT NULL,
	"inferred" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"avatar_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "vibe_objects" (
	"vibe_uuid" uuid NOT NULL,
	"object_uuid" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "vibe_objects_vibe_uuid_object_uuid_pk" PRIMARY KEY("vibe_uuid","object_uuid"),
	CONSTRAINT "vibe_objects_position_check" CHECK ("vibe_objects"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vibe_revisions" (
	"vibe_uuid" uuid NOT NULL,
	"rev" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"membership_delta" jsonb,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vibe_revisions_vibe_uuid_rev_pk" PRIMARY KEY("vibe_uuid","rev")
);
--> statement-breakpoint
CREATE TABLE "vibes" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"owner_uuid" uuid NOT NULL,
	"rnet_schema" text NOT NULL,
	"inferred" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pull_config" jsonb,
	"extensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "elements" ADD CONSTRAINT "elements_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elements" ADD CONSTRAINT "elements_created_for_vibe_vibes_uuid_fk" FOREIGN KEY ("created_for_vibe") REFERENCES "public"."vibes"("uuid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_vibe_uuid_vibes_uuid_fk" FOREIGN KEY ("vibe_uuid") REFERENCES "public"."vibes"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter" ADD CONSTRAINT "meter_operation_uuid_operations_uuid_fk" FOREIGN KEY ("operation_uuid") REFERENCES "public"."operations"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_elements" ADD CONSTRAINT "object_elements_object_uuid_objects_uuid_fk" FOREIGN KEY ("object_uuid") REFERENCES "public"."objects"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_elements" ADD CONSTRAINT "object_elements_element_uuid_elements_uuid_fk" FOREIGN KEY ("element_uuid") REFERENCES "public"."elements"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_origins" ADD CONSTRAINT "object_origins_object_uuid_objects_uuid_fk" FOREIGN KEY ("object_uuid") REFERENCES "public"."objects"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_origins" ADD CONSTRAINT "object_origins_artifact_uuid_origins_uuid_fk" FOREIGN KEY ("artifact_uuid") REFERENCES "public"."origins"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_origins" ADD CONSTRAINT "object_origins_machine_uuid_machines_uuid_fk" FOREIGN KEY ("machine_uuid") REFERENCES "public"."machines"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_revisions" ADD CONSTRAINT "object_revisions_object_uuid_objects_uuid_fk" FOREIGN KEY ("object_uuid") REFERENCES "public"."objects"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_revisions" ADD CONSTRAINT "object_revisions_operation_uuid_operations_uuid_fk" FOREIGN KEY ("operation_uuid") REFERENCES "public"."operations"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_created_for_vibe_vibes_uuid_fk" FOREIGN KEY ("created_for_vibe") REFERENCES "public"."vibes"("uuid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_vibe_uuid_vibes_uuid_fk" FOREIGN KEY ("vibe_uuid") REFERENCES "public"."vibes"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origins" ADD CONSTRAINT "origins_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_objects" ADD CONSTRAINT "vibe_objects_vibe_uuid_vibes_uuid_fk" FOREIGN KEY ("vibe_uuid") REFERENCES "public"."vibes"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_objects" ADD CONSTRAINT "vibe_objects_object_uuid_objects_uuid_fk" FOREIGN KEY ("object_uuid") REFERENCES "public"."objects"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_revisions" ADD CONSTRAINT "vibe_revisions_vibe_uuid_vibes_uuid_fk" FOREIGN KEY ("vibe_uuid") REFERENCES "public"."vibes"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibes" ADD CONSTRAINT "vibes_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "elements_content_hash_idx" ON "elements" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "machines_name_idx" ON "machines" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "object_origins_artifact_unique_idx" ON "object_origins" USING btree ("object_uuid","artifact_uuid") WHERE "object_origins"."machine_uuid" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "object_origins_machine_unique_idx" ON "object_origins" USING btree ("object_uuid","machine_uuid") WHERE "object_origins"."artifact_uuid" IS NULL;--> statement-breakpoint
CREATE INDEX "object_origins_object_idx" ON "object_origins" USING btree ("object_uuid");--> statement-breakpoint
CREATE INDEX "objects_type_idx" ON "objects" USING btree ("type");--> statement-breakpoint
CREATE INDEX "objects_keys_idx" ON "objects" USING gin ("keys");--> statement-breakpoint
CREATE INDEX "objects_inferred_idx" ON "objects" USING gin ("inferred");--> statement-breakpoint
CREATE INDEX "operations_status_idx" ON "operations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "operations_invoked_by_idx" ON "operations" USING btree ("invoked_by");--> statement-breakpoint
CREATE INDEX "origins_content_hash_idx" ON "origins" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "vibe_objects_position_idx" ON "vibe_objects" USING btree ("vibe_uuid","position");