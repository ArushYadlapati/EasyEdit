CREATE TABLE "project_pins" (
	"project_id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"pinned_by" text NOT NULL,
	"pinned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_pins" ADD CONSTRAINT "project_pins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pins" ADD CONSTRAINT "project_pins_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_pins_space_id_idx" ON "project_pins" USING btree ("space_id");