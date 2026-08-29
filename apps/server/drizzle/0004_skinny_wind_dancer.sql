ALTER TABLE "ingestion_source_fetches" DROP CONSTRAINT "ingestion_source_fetches_source_uuid_ingestion_sources_uuid_fk";
--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" DROP CONSTRAINT "ingestion_source_fetches_origin_uuid_origins_uuid_fk";
--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD COLUMN "owner_uuid" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD CONSTRAINT "ingestion_sources_uuid_owner_uuid_unique" UNIQUE("uuid","owner_uuid");--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_source_owner_fk" FOREIGN KEY ("source_uuid","owner_uuid") REFERENCES "public"."ingestion_sources"("uuid","owner_uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_origin_owner_fk" FOREIGN KEY ("origin_uuid","owner_uuid") REFERENCES "public"."origins"("uuid","owner_uuid") ON DELETE no action ON UPDATE no action;
