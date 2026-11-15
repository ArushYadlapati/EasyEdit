CREATE TABLE "drive_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text NOT NULL,
	"broken_at" timestamp,
	"broken_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_storage" (
	"space_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"connection_id" text,
	"root_folder_id" text,
	"folder_name" text,
	"reader_email" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "space_storage_kind_check" CHECK ("space_storage"."kind" in ('shared_folder', 'google_account')),
	CONSTRAINT "space_storage_shape_check" CHECK (("space_storage"."kind" = 'shared_folder' and "space_storage"."connection_id" is null) or ("space_storage"."kind" = 'google_account' and "space_storage"."connection_id" is not null and "space_storage"."root_folder_id" is not null))
);
--> statement-breakpoint
DROP INDEX "assets_unfinished_upload_unique";--> statement-breakpoint
ALTER TABLE "drive_connection" ADD CONSTRAINT "drive_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_storage" ADD CONSTRAINT "space_storage_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_storage" ADD CONSTRAINT "space_storage_connection_id_drive_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."drive_connection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_connection_user_sub_unique" ON "drive_connection" USING btree ("user_id","google_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_unfinished_upload_unique" ON "assets" USING btree ("space_id","uploaded_by","file_name","size_bytes","last_modified_ms") WHERE "assets"."status" = 'uploading';--> statement-breakpoint
INSERT INTO "space_storage" ("space_id", "kind", "connection_id", "root_folder_id", "folder_name", "reader_email", "created_by", "created_at") VALUES ('team_seattle_solvers', 'shared_folder', null, null, null, null, 'system', now());--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "space_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "folders" ALTER COLUMN "space_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "space_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_kind_check" CHECK ("kind" in ('personal', 'team'));--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_role_check" CHECK ("role" in ('admin', 'editor', 'viewer'));
