CREATE TABLE "media_element_revisions" (
	"media_element_uuid" uuid NOT NULL,
	"block" text NOT NULL,
	"rev" integer NOT NULL,
	"snapshot" jsonb,
	"actor" text NOT NULL,
	"operation_uuid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_element_revisions_media_element_uuid_block_rev_pk" PRIMARY KEY("media_element_uuid","block","rev"),
	CONSTRAINT "media_element_revisions_block_check" CHECK ("media_element_revisions"."block" IN ('inferred'))
);
--> statement-breakpoint
ALTER TABLE "media_elements" ADD COLUMN "alt" text;--> statement-breakpoint
ALTER TABLE "media_elements" ADD COLUMN "inferred" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "media_element_revisions" ADD CONSTRAINT "media_element_revisions_media_element_uuid_media_elements_uuid_fk" FOREIGN KEY ("media_element_uuid") REFERENCES "public"."media_elements"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_element_revisions" ADD CONSTRAINT "media_element_revisions_operation_uuid_operations_uuid_fk" FOREIGN KEY ("operation_uuid") REFERENCES "public"."operations"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_elements_inferred_idx" ON "media_elements" USING gin ("inferred");--> statement-breakpoint
ALTER TABLE "media_object_elements" DROP COLUMN "alt";