CREATE TABLE "source_credential_claim_attempts" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"user_uuid" uuid NOT NULL,
	"provider" text NOT NULL,
	"token_fingerprint" text NOT NULL,
	"status" text DEFAULT 'claiming' NOT NULL,
	"credential_uuid" uuid,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_credential_claim_attempts_status_check" CHECK ("source_credential_claim_attempts"."status" IN ('claiming', 'succeeded', 'rejected', 'ambiguous')),
	CONSTRAINT "source_credential_claim_attempts_result_check" CHECK ((
        ("source_credential_claim_attempts"."status" = 'succeeded' AND "source_credential_claim_attempts"."credential_uuid" IS NOT NULL) OR
        ("source_credential_claim_attempts"."status" <> 'succeeded' AND "source_credential_claim_attempts"."credential_uuid" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD COLUMN "credential_uuid" uuid;--> statement-breakpoint
UPDATE "ingestion_source_fetches" AS "fetch"
SET "credential_uuid" = "source"."credential_uuid"
FROM "ingestion_sources" AS "source"
WHERE "source"."uuid" = "fetch"."source_uuid";--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ALTER COLUMN "credential_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_credential_claim_attempts" ADD CONSTRAINT "source_credential_claim_attempts_user_uuid_users_uuid_fk" FOREIGN KEY ("user_uuid") REFERENCES "public"."users"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_credential_claim_attempts" ADD CONSTRAINT "source_credential_claim_attempts_credential_owner_fk" FOREIGN KEY ("credential_uuid","user_uuid") REFERENCES "public"."source_credentials"("uuid","user_uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_credential_claim_attempts_token_unique_idx" ON "source_credential_claim_attempts" USING btree ("provider","token_fingerprint");--> statement-breakpoint
CREATE INDEX "source_credential_claim_attempts_user_created_idx" ON "source_credential_claim_attempts" USING btree ("user_uuid","created_at");--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_credential_owner_fk" FOREIGN KEY ("credential_uuid","owner_uuid") REFERENCES "public"."source_credentials"("uuid","user_uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_source_fetches_credential_created_idx" ON "ingestion_source_fetches" USING btree ("credential_uuid","created_at");--> statement-breakpoint
CREATE FUNCTION "lock_source_credential_revocation_against_fetch"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."revoked_at" IS NULL AND NEW."revoked_at" IS NOT NULL THEN
		PERFORM pg_advisory_xact_lock(hashtextextended(NEW."uuid"::text, 5457486::bigint));
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "source_credentials_revoke_fetch_lock"
BEFORE UPDATE OF "revoked_at" ON "source_credentials"
FOR EACH ROW
EXECUTE FUNCTION "lock_source_credential_revocation_against_fetch"();
