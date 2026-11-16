CREATE TABLE "tutorial_views" (
	"user_id" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tutorial_views" ADD CONSTRAINT "tutorial_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;