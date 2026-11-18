CREATE TABLE "social_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"platform" text NOT NULL,
	"connected_by" text NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"channel_id" text,
	"channel_title" text,
	"refresh_token_enc" text NOT NULL,
	"scopes" text NOT NULL,
	"broken_at" timestamp,
	"broken_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "social_connection_platform_check" CHECK ("social_connection"."platform" in ('youtube'))
);
--> statement-breakpoint
CREATE TABLE "social_post" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"project_id" text,
	"platform" text NOT NULL,
	"posted_by" text NOT NULL,
	"title" text NOT NULL,
	"visibility" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"upload_url_enc" text,
	"video_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "social_post_platform_check" CHECK ("social_post"."platform" in ('youtube')),
	CONSTRAINT "social_post_visibility_check" CHECK ("social_post"."visibility" in ('private', 'unlisted', 'public')),
	CONSTRAINT "social_post_status_check" CHECK ("social_post"."status" in ('uploading', 'posted', 'failed', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "social_connection" ADD CONSTRAINT "social_connection_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_connection_space_platform_unique" ON "social_connection" USING btree ("space_id","platform");--> statement-breakpoint
CREATE INDEX "social_post_space_created_at_idx" ON "social_post" USING btree ("space_id","created_at");