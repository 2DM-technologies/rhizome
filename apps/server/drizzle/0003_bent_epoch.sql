CREATE TABLE "ingestion_source_fetches" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"source_uuid" uuid NOT NULL,
	"operation_uuid" uuid NOT NULL,
	"origin_uuid" uuid,
	"parser_version" text NOT NULL,
	"source_state_digest" text NOT NULL,
	"status" text DEFAULT 'fetching' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retrieved_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	CONSTRAINT "ingestion_source_fetches_status_check" CHECK ("ingestion_source_fetches"."status" IN ('fetching', 'fetched', 'verified', 'rejected', 'committed'))
);
--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_source_uuid_ingestion_sources_uuid_fk" FOREIGN KEY ("source_uuid") REFERENCES "public"."ingestion_sources"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_operation_uuid_operations_uuid_fk" FOREIGN KEY ("operation_uuid") REFERENCES "public"."operations"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_origin_uuid_origins_uuid_fk" FOREIGN KEY ("origin_uuid") REFERENCES "public"."origins"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_source_fetches_operation_source_unique_idx" ON "ingestion_source_fetches" USING btree ("operation_uuid","source_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_source_fetches_origin_unique_idx" ON "ingestion_source_fetches" USING btree ("origin_uuid");--> statement-breakpoint
CREATE INDEX "ingestion_source_fetches_source_status_idx" ON "ingestion_source_fetches" USING btree ("source_uuid","status","created_at");