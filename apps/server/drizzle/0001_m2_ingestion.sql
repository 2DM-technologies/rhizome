CREATE TABLE "ingestion_sources" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"owner_uuid" uuid NOT NULL,
	"kind" text NOT NULL,
	"skill_id" text NOT NULL,
	"connector_version" text NOT NULL,
	"parser" text NOT NULL,
	"parser_version" text NOT NULL,
	"origin_uuid" uuid,
	"credential_uuid" uuid,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "ingestion_sources_uuid_owner_uuid_unique" UNIQUE("uuid","owner_uuid"),
	CONSTRAINT "ingestion_sources_reference_check" CHECK ((
        ("ingestion_sources"."kind" = 'origin' AND "ingestion_sources"."origin_uuid" IS NOT NULL AND "ingestion_sources"."credential_uuid" IS NULL) OR
        ("ingestion_sources"."kind" = 'credential' AND "ingestion_sources"."credential_uuid" IS NOT NULL AND "ingestion_sources"."origin_uuid" IS NULL) OR
        ("ingestion_sources"."kind" = 'remote' AND "ingestion_sources"."origin_uuid" IS NULL AND "ingestion_sources"."credential_uuid" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "ingestion_source_fetches" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"source_uuid" uuid NOT NULL,
	"owner_uuid" uuid NOT NULL,
	"credential_uuid" uuid,
	"operation_uuid" uuid NOT NULL,
	"origin_uuid" uuid,
	"connector_version" text NOT NULL,
	"parser_version" text NOT NULL,
	"source_state_digest" text NOT NULL,
	"status" text DEFAULT 'fetching' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retrieved_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	CONSTRAINT "ingestion_source_fetches_status_check" CHECK ("ingestion_source_fetches"."status" IN ('fetching', 'fetched', 'verified', 'rejected', 'committed'))
);
--> statement-breakpoint
CREATE TABLE "ingestion_source_objects" (
	"source_uuid" uuid NOT NULL,
	"identity" text NOT NULL,
	"media_object_uuid" uuid NOT NULL,
	"candidate_digest" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_source_objects_source_uuid_identity_pk" PRIMARY KEY("source_uuid","identity")
);
--> statement-breakpoint
CREATE TABLE "source_credentials" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"user_uuid" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"connector_version" text NOT NULL,
	"secret" "bytea" NOT NULL,
	"metadata" jsonb,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "source_credentials_uuid_user_uuid_unique" UNIQUE("uuid","user_uuid"),
	CONSTRAINT "source_credentials_uuid_user_uuid_skill_connector_unique" UNIQUE("uuid","user_uuid","skill_id","connector_version")
);
--> statement-breakpoint
CREATE TABLE "source_credential_claim_attempts" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"user_uuid" uuid NOT NULL,
	"skill_id" text NOT NULL,
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
CREATE TABLE "source_credential_claim_fingerprints" (
	"skill_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"attempt_uuid" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_credential_claim_fingerprints_pk" PRIMARY KEY("skill_id","fingerprint")
);
--> statement-breakpoint
ALTER TABLE "operations" DROP CONSTRAINT "operations_vibe_uuid_vibes_uuid_fk";
--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "review_digest" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "committed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "origins" ADD CONSTRAINT "origins_uuid_owner_uuid_unique" UNIQUE("uuid","owner_uuid");--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD CONSTRAINT "ingestion_sources_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD CONSTRAINT "ingestion_sources_origin_owner_fk" FOREIGN KEY ("origin_uuid","owner_uuid") REFERENCES "public"."origins"("uuid","owner_uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD CONSTRAINT "ingestion_sources_credential_owner_skill_connector_fk" FOREIGN KEY ("credential_uuid","owner_uuid","skill_id","connector_version") REFERENCES "public"."source_credentials"("uuid","user_uuid","skill_id","connector_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_operation_uuid_operations_uuid_fk" FOREIGN KEY ("operation_uuid") REFERENCES "public"."operations"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_source_owner_fk" FOREIGN KEY ("source_uuid","owner_uuid") REFERENCES "public"."ingestion_sources"("uuid","owner_uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_origin_owner_fk" FOREIGN KEY ("origin_uuid","owner_uuid") REFERENCES "public"."origins"("uuid","owner_uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_fetches" ADD CONSTRAINT "ingestion_source_fetches_credential_owner_fk" FOREIGN KEY ("credential_uuid","owner_uuid") REFERENCES "public"."source_credentials"("uuid","user_uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_objects" ADD CONSTRAINT "ingestion_source_objects_source_uuid_ingestion_sources_uuid_fk" FOREIGN KEY ("source_uuid") REFERENCES "public"."ingestion_sources"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_objects" ADD CONSTRAINT "ingestion_source_objects_media_object_uuid_media_objects_uuid_fk" FOREIGN KEY ("media_object_uuid") REFERENCES "public"."media_objects"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_credentials" ADD CONSTRAINT "source_credentials_user_uuid_users_uuid_fk" FOREIGN KEY ("user_uuid") REFERENCES "public"."users"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_credential_claim_attempts" ADD CONSTRAINT "source_credential_claim_attempts_user_uuid_users_uuid_fk" FOREIGN KEY ("user_uuid") REFERENCES "public"."users"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_credential_claim_attempts" ADD CONSTRAINT "source_credential_claim_attempts_credential_owner_fk" FOREIGN KEY ("credential_uuid","user_uuid") REFERENCES "public"."source_credentials"("uuid","user_uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_credential_claim_fingerprints" ADD CONSTRAINT "source_credential_claim_fingerprints_attempt_fk" FOREIGN KEY ("attempt_uuid") REFERENCES "public"."source_credential_claim_attempts"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_source_fetches_operation_source_unique_idx" ON "ingestion_source_fetches" USING btree ("operation_uuid","source_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_source_fetches_origin_unique_idx" ON "ingestion_source_fetches" USING btree ("origin_uuid");--> statement-breakpoint
CREATE INDEX "ingestion_source_fetches_source_status_idx" ON "ingestion_source_fetches" USING btree ("source_uuid","status","created_at");--> statement-breakpoint
CREATE INDEX "ingestion_source_fetches_credential_created_idx" ON "ingestion_source_fetches" USING btree ("credential_uuid","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_source_objects_source_object_unique_idx" ON "ingestion_source_objects" USING btree ("source_uuid","media_object_uuid");--> statement-breakpoint
CREATE INDEX "ingestion_source_objects_object_idx" ON "ingestion_source_objects" USING btree ("media_object_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "source_credential_claim_attempts_token_unique_idx" ON "source_credential_claim_attempts" USING btree ("skill_id","token_fingerprint");--> statement-breakpoint
CREATE INDEX "source_credential_claim_attempts_user_created_idx" ON "source_credential_claim_attempts" USING btree ("user_uuid","created_at");--> statement-breakpoint
CREATE INDEX "source_credential_claim_fingerprints_attempt_idx" ON "source_credential_claim_fingerprints" USING btree ("attempt_uuid");--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_vibe_uuid_vibes_uuid_fk" FOREIGN KEY ("vibe_uuid") REFERENCES "public"."vibes"("uuid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operations_vibe_uuid_idx" ON "operations" USING btree ("vibe_uuid");--> statement-breakpoint
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
