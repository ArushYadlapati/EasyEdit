CREATE TABLE "project_move" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"from_space_id" text NOT NULL,
	"to_space_id" text NOT NULL,
	"started_by" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"abandoned_at" timestamp
);
--> statement-breakpoint
DROP INDEX "assets_unfinished_upload_unique";--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "move_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "copied_from" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "moved_at_version" integer;--> statement-breakpoint
ALTER TABLE "project_move" ADD CONSTRAINT "project_move_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_move" ADD CONSTRAINT "project_move_from_space_id_organization_id_fk" FOREIGN KEY ("from_space_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_move" ADD CONSTRAINT "project_move_to_space_id_organization_id_fk" FOREIGN KEY ("to_space_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_move_project_id_idx" ON "project_move" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_move_started_by_idx" ON "project_move" USING btree ("started_by");--> statement-breakpoint
CREATE INDEX "project_move_to_space_id_started_at_idx" ON "project_move" USING btree ("to_space_id","started_at");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_move_id_project_move_id_fk" FOREIGN KEY ("move_id") REFERENCES "public"."project_move"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_unfinished_upload_unique" ON "assets" USING btree ("space_id","uploaded_by","file_name","size_bytes","last_modified_ms") WHERE "assets"."status" = 'uploading' and "assets"."move_id" is null;