CREATE TABLE "source_credential_claim_fingerprints" (
	"provider" text NOT NULL,
	"fingerprint" text NOT NULL,
	"attempt_uuid" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_credential_claim_fingerprints_pk" PRIMARY KEY("provider","fingerprint")
);
--> statement-breakpoint
INSERT INTO "source_credential_claim_fingerprints" (
	"provider",
	"fingerprint",
	"attempt_uuid",
	"created_at"
)
SELECT
	"provider",
	"token_fingerprint",
	"uuid",
	"created_at"
FROM "source_credential_claim_attempts"
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "source_credential_claim_fingerprints" ADD CONSTRAINT "source_credential_claim_fingerprints_attempt_fk" FOREIGN KEY ("attempt_uuid") REFERENCES "public"."source_credential_claim_attempts"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_credential_claim_fingerprints_attempt_idx" ON "source_credential_claim_fingerprints" USING btree ("attempt_uuid");
