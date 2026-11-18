CREATE TABLE "asset_transcripts" (
	"asset_id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"words" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_transcripts" ADD CONSTRAINT "asset_transcripts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transcripts" ADD CONSTRAINT "asset_transcripts_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_transcripts_space_id_idx" ON "asset_transcripts" USING btree ("space_id");