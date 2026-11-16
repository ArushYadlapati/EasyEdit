CREATE TABLE "onboarding" (
	"user_id" text PRIMARY KEY NOT NULL,
	"finished_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding" ADD CONSTRAINT "onboarding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_uploaded_by_created_at_idx" ON "assets" USING btree ("uploaded_by","created_at");--> statement-breakpoint
CREATE INDEX "projects_created_by_created_at_idx" ON "projects" USING btree ("created_by","created_at");--> statement-breakpoint
insert into "onboarding" ("user_id", "finished_at") select "id", now() from "user" on conflict do nothing;
