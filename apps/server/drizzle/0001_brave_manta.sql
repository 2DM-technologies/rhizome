CREATE TABLE "ingestion_sources" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"owner_uuid" uuid NOT NULL,
	"kind" text NOT NULL,
	"parser" text NOT NULL,
	"parser_version" text NOT NULL,
	"origin_uuid" uuid,
	"credential_uuid" uuid,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "ingestion_sources_reference_check" CHECK ((
        ("ingestion_sources"."kind" = 'origin' AND "ingestion_sources"."origin_uuid" IS NOT NULL AND "ingestion_sources"."credential_uuid" IS NULL) OR
        ("ingestion_sources"."kind" = 'credential' AND "ingestion_sources"."credential_uuid" IS NOT NULL AND "ingestion_sources"."origin_uuid" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "source_credentials" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"user_uuid" uuid NOT NULL,
	"provider" text NOT NULL,
	"secret" "bytea" NOT NULL,
	"metadata" jsonb,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "source_credentials_uuid_user_uuid_unique" UNIQUE("uuid","user_uuid")
);
--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "review_digest" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "committed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "origins" ADD CONSTRAINT "origins_uuid_owner_uuid_unique" UNIQUE("uuid","owner_uuid");--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD CONSTRAINT "ingestion_sources_owner_uuid_users_uuid_fk" FOREIGN KEY ("owner_uuid") REFERENCES "public"."users"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD CONSTRAINT "ingestion_sources_origin_owner_fk" FOREIGN KEY ("origin_uuid","owner_uuid") REFERENCES "public"."origins"("uuid","owner_uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD CONSTRAINT "ingestion_sources_credential_owner_fk" FOREIGN KEY ("credential_uuid","owner_uuid") REFERENCES "public"."source_credentials"("uuid","user_uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_credentials" ADD CONSTRAINT "source_credentials_user_uuid_users_uuid_fk" FOREIGN KEY ("user_uuid") REFERENCES "public"."users"("uuid") ON DELETE cascade ON UPDATE no action;
