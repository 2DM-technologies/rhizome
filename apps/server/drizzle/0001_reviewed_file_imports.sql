CREATE TABLE "ingestion_sources" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"owner_uuid" uuid NOT NULL,
	"kind" text NOT NULL,
	"parser" text NOT NULL,
	"parser_version" text NOT NULL,
	"origin_uuid" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "ingestion_sources_uuid_owner_uuid_unique" UNIQUE("uuid","owner_uuid"),
	CONSTRAINT "ingestion_sources_kind_check" CHECK ("ingestion_sources"."kind" = 'origin')
);
--> statement-breakpoint
CREATE TABLE "ingestion_source_objects" (
	"source_uuid" uuid NOT NULL,
	"identity" text NOT NULL,
	"media_object_uuid" uuid NOT NULL,
	"candidate_digest" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_source_objects_source_uuid_identity_pk" PRIMARY KEY("source_uuid","identity")
);
--> statement-breakpoint
ALTER TABLE "operations" DROP CONSTRAINT "operations_vibe_uuid_vibes_uuid_fk";
--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "review_digest" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "committed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "origins" ADD CONSTRAINT "origins_uuid_owner_uuid_unique" UNIQUE("uuid","owner_uuid");--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD CONSTRAINT "ingestion_sources_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD CONSTRAINT "ingestion_sources_origin_owner_fk" FOREIGN KEY ("origin_uuid","owner_uuid") REFERENCES "public"."origins"("uuid","owner_uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_objects" ADD CONSTRAINT "ingestion_source_objects_source_uuid_ingestion_sources_uuid_fk" FOREIGN KEY ("source_uuid") REFERENCES "public"."ingestion_sources"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_objects" ADD CONSTRAINT "ingestion_source_objects_media_object_uuid_media_objects_uuid_fk" FOREIGN KEY ("media_object_uuid") REFERENCES "public"."media_objects"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_source_objects_source_object_unique_idx" ON "ingestion_source_objects" USING btree ("source_uuid","media_object_uuid");--> statement-breakpoint
CREATE INDEX "ingestion_source_objects_object_idx" ON "ingestion_source_objects" USING btree ("media_object_uuid");--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_vibe_uuid_vibes_uuid_fk" FOREIGN KEY ("vibe_uuid") REFERENCES "public"."vibes"("uuid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operations_vibe_uuid_idx" ON "operations" USING btree ("vibe_uuid");
