CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	"kind" text DEFAULT 'team' NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_visits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"visited_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_visits" ADD CONSTRAINT "space_visits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_visits" ADD CONSTRAINT "space_visits_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organizationId_userId_idx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "space_id" text;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "space_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "space_id" text;--> statement-breakpoint
INSERT INTO "organization" ("id", "name", "slug", "created_at", "kind") VALUES ('team_seattle_solvers', 'Seattle Solvers', 'seattle-solvers', now(), 'team');--> statement-breakpoint
INSERT INTO "organization" ("id", "name", "slug", "created_at", "kind") SELECT 'personal_' || "id", 'Personal', 'personal_' || "id", now(), 'personal' FROM "user";--> statement-breakpoint
INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at") SELECT 'mp_' || "id", 'personal_' || "id", "id", 'admin', now() FROM "user";--> statement-breakpoint
INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at") SELECT 'mt_' || "user"."id", 'team_seattle_solvers', "user"."id", "allowlist"."role", now() FROM "allowlist" JOIN "user" ON lower(trim("user"."email")) = "allowlist"."email";--> statement-breakpoint
UPDATE "projects" SET "space_id" = 'team_seattle_solvers';--> statement-breakpoint
UPDATE "folders" SET "space_id" = 'team_seattle_solvers';--> statement-breakpoint
UPDATE "assets" SET "space_id" = 'team_seattle_solvers';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "space_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "folders" ALTER COLUMN "space_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "space_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_space_id_organization_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_space_id_idx" ON "projects" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "folders_space_id_idx" ON "folders" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "assets_space_id_idx" ON "assets" USING btree ("space_id");--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "space_id" SET DEFAULT 'team_seattle_solvers';--> statement-breakpoint
ALTER TABLE "folders" ALTER COLUMN "space_id" SET DEFAULT 'team_seattle_solvers';--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "space_id" SET DEFAULT 'team_seattle_solvers';--> statement-breakpoint
DROP INDEX "folders_name_lower_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "folders_space_name_lower_unique" ON "folders" USING btree ("space_id",lower("name"));
