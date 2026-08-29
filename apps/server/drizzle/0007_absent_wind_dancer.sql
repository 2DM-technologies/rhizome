ALTER TABLE "ingestion_sources" DROP CONSTRAINT "ingestion_sources_reference_check";--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ALTER COLUMN "credential_uuid" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD CONSTRAINT "ingestion_sources_reference_check" CHECK ((
        ("ingestion_sources"."kind" = 'origin' AND "ingestion_sources"."origin_uuid" IS NOT NULL AND "ingestion_sources"."credential_uuid" IS NULL AND "ingestion_sources"."provider" IS NULL) OR
        ("ingestion_sources"."kind" = 'credential' AND "ingestion_sources"."credential_uuid" IS NOT NULL AND "ingestion_sources"."origin_uuid" IS NULL AND "ingestion_sources"."provider" IS NULL) OR
        ("ingestion_sources"."kind" = 'remote' AND "ingestion_sources"."origin_uuid" IS NULL AND "ingestion_sources"."credential_uuid" IS NULL AND "ingestion_sources"."provider" = 'arena')
      ));