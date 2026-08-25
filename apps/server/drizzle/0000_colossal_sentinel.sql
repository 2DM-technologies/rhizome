CREATE TABLE "grants" (
	"vibe_uuid" uuid NOT NULL,
	"subject" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "grants_vibe_uuid_subject_pk" PRIMARY KEY("vibe_uuid","subject")
);
--> statement-breakpoint
CREATE TABLE "dmachines" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_uuid" uuid,
	"trust" text DEFAULT 'standard' NOT NULL,
	"generated" boolean DEFAULT false NOT NULL,
	"code_hash" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dmachines_trust_check" CHECK ("dmachines"."trust" IN ('system', 'standard'))
);
--> statement-breakpoint
CREATE TABLE "media_elements" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"owner_uuid" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"rnet_schema" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"tombstoned_at" timestamp with time zone,
	CONSTRAINT "media_elements_kind_check" CHECK ("media_elements"."kind" IN ('text', 'image', 'audio', 'video', 'document'))
);
--> statement-breakpoint
CREATE TABLE "media_object_elements" (
	"media_object_uuid" uuid NOT NULL,
	"media_element_uuid" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "media_object_elements_media_object_uuid_position_pk" PRIMARY KEY("media_object_uuid","position")
);
--> statement-breakpoint
CREATE TABLE "media_object_origins" (
	"media_object_uuid" uuid NOT NULL,
	"artifact_uuid" uuid,
	"dmachine_uuid" uuid,
	CONSTRAINT "media_object_origins_exactly_one_check" CHECK (num_nonnulls("media_object_origins"."artifact_uuid", "media_object_origins"."dmachine_uuid") = 1)
);
--> statement-breakpoint
CREATE TABLE "media_object_revisions" (
	"media_object_uuid" uuid NOT NULL,
	"block" text NOT NULL,
	"rev" integer NOT NULL,
	"snapshot" jsonb,
	"actor" text NOT NULL,
	"operation_uuid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_object_revisions_media_object_uuid_block_rev_pk" PRIMARY KEY("media_object_uuid","block","rev"),
	CONSTRAINT "media_object_revisions_block_check" CHECK ("media_object_revisions"."block" IN ('source', 'user', 'inferred'))
);
--> statement-breakpoint
CREATE TABLE "media_objects" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"owner_uuid" uuid NOT NULL,
	"created_by" text NOT NULL,
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
CREATE TABLE "meter_entry" (
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
CREATE TABLE "vibe_media_objects" (
	"vibe_uuid" uuid NOT NULL,
	"media_object_uuid" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "vibe_media_objects_vibe_uuid_position_pk" PRIMARY KEY("vibe_uuid","position"),
	CONSTRAINT "vibe_media_objects_position_check" CHECK ("vibe_media_objects"."position" >= 0)
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
ALTER TABLE "grants" ADD CONSTRAINT "grants_vibe_uuid_vibes_uuid_fk" FOREIGN KEY ("vibe_uuid") REFERENCES "public"."vibes"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmachines" ADD CONSTRAINT "dmachines_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_elements" ADD CONSTRAINT "media_elements_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object_elements" ADD CONSTRAINT "media_object_elements_media_object_uuid_media_objects_uuid_fk" FOREIGN KEY ("media_object_uuid") REFERENCES "public"."media_objects"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object_elements" ADD CONSTRAINT "media_object_elements_media_element_uuid_media_elements_uuid_fk" FOREIGN KEY ("media_element_uuid") REFERENCES "public"."media_elements"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object_origins" ADD CONSTRAINT "media_object_origins_media_object_uuid_media_objects_uuid_fk" FOREIGN KEY ("media_object_uuid") REFERENCES "public"."media_objects"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object_origins" ADD CONSTRAINT "media_object_origins_artifact_uuid_origins_uuid_fk" FOREIGN KEY ("artifact_uuid") REFERENCES "public"."origins"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object_origins" ADD CONSTRAINT "media_object_origins_dmachine_uuid_dmachines_uuid_fk" FOREIGN KEY ("dmachine_uuid") REFERENCES "public"."dmachines"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object_revisions" ADD CONSTRAINT "media_object_revisions_media_object_uuid_media_objects_uuid_fk" FOREIGN KEY ("media_object_uuid") REFERENCES "public"."media_objects"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object_revisions" ADD CONSTRAINT "media_object_revisions_operation_uuid_operations_uuid_fk" FOREIGN KEY ("operation_uuid") REFERENCES "public"."operations"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_entry" ADD CONSTRAINT "meter_entry_operation_uuid_operations_uuid_fk" FOREIGN KEY ("operation_uuid") REFERENCES "public"."operations"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_vibe_uuid_vibes_uuid_fk" FOREIGN KEY ("vibe_uuid") REFERENCES "public"."vibes"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origins" ADD CONSTRAINT "origins_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_media_objects" ADD CONSTRAINT "vibe_media_objects_vibe_uuid_vibes_uuid_fk" FOREIGN KEY ("vibe_uuid") REFERENCES "public"."vibes"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_media_objects" ADD CONSTRAINT "vibe_media_objects_media_object_uuid_media_objects_uuid_fk" FOREIGN KEY ("media_object_uuid") REFERENCES "public"."media_objects"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_revisions" ADD CONSTRAINT "vibe_revisions_vibe_uuid_vibes_uuid_fk" FOREIGN KEY ("vibe_uuid") REFERENCES "public"."vibes"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibes" ADD CONSTRAINT "vibes_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dmachines_name_idx" ON "dmachines" USING btree ("name");--> statement-breakpoint
CREATE INDEX "media_elements_content_hash_idx" ON "media_elements" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "media_object_origins_artifact_unique_idx" ON "media_object_origins" USING btree ("media_object_uuid","artifact_uuid") WHERE "media_object_origins"."dmachine_uuid" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "media_object_origins_dmachine_unique_idx" ON "media_object_origins" USING btree ("media_object_uuid","dmachine_uuid") WHERE "media_object_origins"."artifact_uuid" IS NULL;--> statement-breakpoint
CREATE INDEX "media_object_origins_object_idx" ON "media_object_origins" USING btree ("media_object_uuid");--> statement-breakpoint
CREATE INDEX "media_objects_type_idx" ON "media_objects" USING btree ("type");--> statement-breakpoint
CREATE INDEX "media_objects_keys_idx" ON "media_objects" USING gin ("keys");--> statement-breakpoint
CREATE INDEX "media_objects_inferred_idx" ON "media_objects" USING gin ("inferred");--> statement-breakpoint
CREATE INDEX "operations_status_idx" ON "operations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "operations_invoked_by_idx" ON "operations" USING btree ("invoked_by");--> statement-breakpoint
CREATE INDEX "origins_content_hash_idx" ON "origins" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "vibe_media_objects_media_object_idx" ON "vibe_media_objects" USING btree ("media_object_uuid");