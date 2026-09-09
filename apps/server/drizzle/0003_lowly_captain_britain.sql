ALTER TABLE "ingestion_sources" ADD COLUMN "execution_limits" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD COLUMN "execution_limits" jsonb NOT NULL;