ALTER TABLE "operations" ADD COLUMN "owner_uuid" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operations_owner_uuid_idx" ON "operations" USING btree ("owner_uuid");