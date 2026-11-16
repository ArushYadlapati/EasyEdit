UPDATE "allowlist" SET "role" = 'editor' WHERE "role" = 'viewer';--> statement-breakpoint
UPDATE "member" SET "role" = 'editor' WHERE "role" = 'viewer';--> statement-breakpoint
UPDATE "invitation" SET "role" = 'editor' WHERE "role" = 'viewer';--> statement-breakpoint
ALTER TABLE "space_storage" ADD COLUMN "google_sub" text;--> statement-breakpoint
UPDATE "space_storage" SET "google_sub" = "drive_connection"."google_sub" FROM "drive_connection" WHERE "space_storage"."connection_id" = "drive_connection"."id" AND "space_storage"."kind" = 'google_account';--> statement-breakpoint
CREATE UNIQUE INDEX "space_storage_google_sub_unique" ON "space_storage" USING btree ("google_sub") WHERE google_sub is not null;
