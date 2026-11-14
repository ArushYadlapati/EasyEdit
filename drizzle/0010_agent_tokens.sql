CREATE TABLE "agent_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"agent" text NOT NULL,
	"token_hash" text NOT NULL,
	"preview" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	CONSTRAINT "agent_token_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "agent_token_agent_check" CHECK ("agent_token"."agent" in ('claude', 'chatgpt', 'claude-code', 'cursor', 'vscode', 'codex', 'gemini-cli', 'openai-api', 'other'))
);
--> statement-breakpoint
ALTER TABLE "agent_token" ADD CONSTRAINT "agent_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_token_user_id_idx" ON "agent_token" USING btree ("user_id");