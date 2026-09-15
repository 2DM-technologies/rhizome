ALTER TABLE "media_elements" ADD COLUMN "inferred_rev" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "inferred_rev" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vibe_revisions" ADD COLUMN "operation_uuid" uuid;--> statement-breakpoint
ALTER TABLE "vibe_revisions" ADD CONSTRAINT "vibe_revisions_operation_uuid_operations_uuid_fk" FOREIGN KEY ("operation_uuid") REFERENCES "public"."operations"("uuid") ON DELETE no action ON UPDATE no action;