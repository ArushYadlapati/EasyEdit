CREATE TABLE "project_presence" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tab_id" text NOT NULL,
	"clip_ids" jsonb NOT NULL,
	"track_id" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"seen_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	CONSTRAINT "project_presence_project_id_user_id_tab_id_pk" PRIMARY KEY("project_id","user_id","tab_id")
);
--> statement-breakpoint
ALTER TABLE "project_presence" ADD CONSTRAINT "project_presence_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_presence" ADD CONSTRAINT "project_presence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;