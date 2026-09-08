ALTER TABLE "media_object_elements" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "media_object_elements" ADD COLUMN "alt" text;--> statement-breakpoint
ALTER TABLE "media_object_elements" ADD CONSTRAINT "media_object_elements_role_check" CHECK ("media_object_elements"."role" IN ('title', 'content', 'preview'));