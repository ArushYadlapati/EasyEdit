CREATE TABLE "brand_kit" (
	"space_id" text PRIMARY KEY NOT NULL,
	"title_font" text NOT NULL,
	"subtitle_font" text NOT NULL,
	"body_font" text NOT NULL,
	"colors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logo_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;