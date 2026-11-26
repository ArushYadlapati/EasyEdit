CREATE TABLE "space_style" (
	"space_id" text PRIMARY KEY NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "style_reference" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"asset_id" text,
	"project_id" text,
	"url" text,
	"provider" text,
	"author" text,
	"thumbnail_url" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"failure" text,
	"analysis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sheet" "bytea",
	"fetched_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "style_reference_kind_check" CHECK ("style_reference"."kind" in ('video', 'link', 'project')),
	CONSTRAINT "style_reference_status_check" CHECK ("style_reference"."status" in ('pending', 'ready', 'failed')),
	CONSTRAINT "style_reference_provider_check" CHECK ("style_reference"."provider" is null or "style_reference"."provider" in ('youtube', 'vimeo', 'tiktok', 'channel')),
	CONSTRAINT "style_reference_source_check" CHECK (("style_reference"."kind" = 'video' and "style_reference"."asset_id" is not null) or ("style_reference"."kind" = 'link' and "style_reference"."url" is not null) or ("style_reference"."kind" = 'project' and "style_reference"."project_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "space_style" ADD CONSTRAINT "space_style_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_reference" ADD CONSTRAINT "style_reference_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_reference" ADD CONSTRAINT "style_reference_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_reference" ADD CONSTRAINT "style_reference_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "style_reference_space_id_idx" ON "style_reference" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "style_reference_space_asset_unique" ON "style_reference" USING btree ("space_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "style_reference_space_project_unique" ON "style_reference" USING btree ("space_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "style_reference_space_url_unique" ON "style_reference" USING btree ("space_id","url");