ALTER TABLE "operations" DROP CONSTRAINT "operations_vibe_uuid_vibes_uuid_fk";
--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_vibe_uuid_vibes_uuid_fk" FOREIGN KEY ("vibe_uuid") REFERENCES "public"."vibes"("uuid") ON DELETE set null ON UPDATE no action;