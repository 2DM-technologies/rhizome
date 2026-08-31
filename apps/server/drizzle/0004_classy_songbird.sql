CREATE TABLE "source_connection_attempts" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"user_uuid" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"connector_version" text NOT NULL,
	"state_hash" text NOT NULL,
	"browser_binding_hash" text NOT NULL,
	"verifier" "bytea" NOT NULL,
	"callback_url" text NOT NULL,
	"return_url" text NOT NULL,
	"intent" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credential_uuid" uuid,
	"error_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "source_connection_attempts_status_check" CHECK ("source_connection_attempts"."status" IN ('pending', 'exchanging', 'succeeded', 'rejected', 'failed', 'expired')),
	CONSTRAINT "source_connection_attempts_result_check" CHECK ((
        ("source_connection_attempts"."status" IN ('pending', 'exchanging') AND "source_connection_attempts"."credential_uuid" IS NULL AND "source_connection_attempts"."error_code" IS NULL AND "source_connection_attempts"."completed_at" IS NULL) OR
        ("source_connection_attempts"."status" = 'succeeded' AND "source_connection_attempts"."credential_uuid" IS NOT NULL AND "source_connection_attempts"."error_code" IS NULL AND "source_connection_attempts"."completed_at" IS NOT NULL) OR
        ("source_connection_attempts"."status" IN ('rejected', 'failed', 'expired') AND "source_connection_attempts"."credential_uuid" IS NULL AND "source_connection_attempts"."error_code" IS NOT NULL AND "source_connection_attempts"."completed_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "source_connection_attempts" ADD CONSTRAINT "source_connection_attempts_user_uuid_users_uuid_fk" FOREIGN KEY ("user_uuid") REFERENCES "public"."users"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_connection_attempts" ADD CONSTRAINT "source_connection_attempts_credential_owner_skill_version_fk" FOREIGN KEY ("credential_uuid","user_uuid","skill_id","connector_version") REFERENCES "public"."source_credentials"("uuid","user_uuid","skill_id","connector_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_connection_attempts_state_hash_unique_idx" ON "source_connection_attempts" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "source_connection_attempts_owner_created_idx" ON "source_connection_attempts" USING btree ("user_uuid","created_at");--> statement-breakpoint
ALTER TABLE "source_credentials" ADD COLUMN "provider_revoked_at" timestamp with time zone;
