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
ALTER TABLE "ingestion_source_objects" ADD CONSTRAINT "ingestion_source_objects_source_uuid_ingestion_sources_uuid_fk" FOREIGN KEY ("source_uuid") REFERENCES "public"."ingestion_sources"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_objects" ADD CONSTRAINT "ingestion_source_objects_media_object_uuid_media_objects_uuid_fk" FOREIGN KEY ("media_object_uuid") REFERENCES "public"."media_objects"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_source_objects_source_object_unique_idx" ON "ingestion_source_objects" USING btree ("source_uuid","media_object_uuid");--> statement-breakpoint
CREATE INDEX "ingestion_source_objects_object_idx" ON "ingestion_source_objects" USING btree ("media_object_uuid");