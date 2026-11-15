import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, index, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import type { AgentKind } from "@/lib/connector/agents";
import type { FormatId, Op, TimelineDoc } from "@/lib/timeline";
import { organization, user } from "./auth-schema";

export * from "./auth-schema";

export const allowlist = pgTable(
  "allowlist",
  {
    email: text("email").primaryKey(),
    role: text("role", { enum: ["admin", "editor", "viewer"] }).notNull(),
    invitedBy: text("invited_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("allowlist_role_check", sql`${t.role} in ('admin', 'editor', 'viewer')`),
    check("allowlist_email_normalized", sql`${t.email} = lower(trim(${t.email}))`),
  ],
);

// The space every project, folder and upload belongs to.
const spaceId = () =>
  text("space_id")
    .notNull()
    .references(() => organization.id);

// One level deep, in one space. Names are unique within a space regardless of case.
export const folders = pgTable(
  "folders",
  {
    id: text("id").primaryKey(),
    spaceId: spaceId(),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("folders_space_name_lower_unique").on(t.spaceId, sql`lower("name")`), index("folders_space_id_idx").on(t.spaceId)],
);

// drizzle 0.45 has no bytea(). PGlite reads a Uint8Array and neon-http a Buffer; hex text ("\x…") is decoded too,
// should a driver hand bytea over as text. Every read is copied into a fresh Uint8Array<ArrayBuffer>, which a
// Response body accepts.
const bytea = customType<{ data: Uint8Array<ArrayBuffer>; driverData: Uint8Array | string }>({
  dataType: () => "bytea",
  fromDriver: (value) => (typeof value === "string" ? fromHex(value) : Uint8Array.from(value)),
});

function fromHex(text: string): Uint8Array<ArrayBuffer> {
  const hex = text.startsWith("\\x") ? text.slice(2) : text;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    spaceId: spaceId(),
    name: text("name").notNull(),
    format: text("format").$type<FormatId>().notNull(),
    doc: jsonb("doc").$type<TimelineDoc>().notNull(),
    version: integer("version").notNull().default(0),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // Set when the project is deleted; a deleted project is hidden from every read and write.
    deletedAt: timestamp("deleted_at"),
    // Deleting a folder leaves its projects in no folder.
    folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
    // Kept in step with the doc; empty on rows old code wrote, so readers fall back to the doc.
    width: integer("width"),
    height: integer("height"),
    // The dashboard card's JPEG; only readThumbnail selects it.
    thumbnail: bytea("thumbnail"),
    // The project version the picture was drawn from.
    thumbnailVersion: integer("thumbnail_version"),
  },
  (t) => [index("projects_space_id_idx").on(t.spaceId)],
);

// When each person last opened each project, for their Recent list.
export const projectOpens = pgTable(
  "project_opens",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    openedAt: timestamp("opened_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })],
);

// What each open editor tab has selected, so teammates in the same project see it. One row per tab, written by the
// tab's check for changes. A closing tab marks its row as left. A row not written for LIMITS.presenceTtlMs is left out
// of every read, and rows older than LIMITS.presenceKeepMs are deleted by anyone's check.
export const projectPresence = pgTable(
  "project_presence",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tabId: text("tab_id").notNull(),
    clipIds: jsonb("clip_ids").$type<string[]>().notNull(),
    trackId: text("track_id"),
    changedAt: timestamp("changed_at").notNull().defaultNow(), // when this tab's selection last changed: a person's latest tab wins
    seenAt: timestamp("seen_at").notNull().defaultNow(), // the database's clock, never the browser's
    leftAt: timestamp("left_at"), // set when the tab said it was closing; a late check from that tab then writes nothing
  },
  // No timestamp is indexed, so a refresh can be a heap-only update.
  (t) => [primaryKey({ columns: [t.projectId, t.userId, t.tabId] })],
);

export const projectOps = pgTable(
  "project_ops",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    ops: jsonb("ops").$type<Op[]>().notNull(),
    // Null on rows written before inverses were stored.
    inverse: jsonb("inverse").$type<Op[]>(),
    actor: text("actor").notNull(),
    // Set by a client that may retry a write; a request id is applied at most once per project.
    requestId: text("request_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("project_ops_project_id_version_unique").on(t.projectId, t.version),
    uniqueIndex("project_ops_project_id_request_id_unique").on(t.projectId, t.requestId),
    index("project_ops_actor_created_at_idx").on(t.actor, t.createdAt),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    spaceId: spaceId(),
    kind: text("kind", { enum: ["video", "image", "audio"] }).notNull(),
    name: text("name").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    lastModifiedMs: bigint("last_modified_ms", { mode: "number" }).notNull(),
    status: text("status", { enum: ["uploading", "ready"] }).notNull().default("uploading"),
    driveFileId: text("drive_file_id"),
    uploadUrl: text("upload_url"), // the session address; a secret; cleared when the upload completes
    durationMs: integer("duration_ms"),
    width: integer("width"), // as shown, after rotation
    height: integer("height"),
    fps: real("fps"),
    hasAudio: boolean("has_audio").notNull().default(false),
    videoCodec: text("video_codec"),
    previewStatus: text("preview_status", { enum: ["none", "pending", "ready", "failed"] }).notNull().default("none"),
    previewFileId: text("preview_file_id"),
    posterFileId: text("poster_file_id"),
    pendingPreviewFileId: text("pending_preview_file_id"), // chosen when that upload was opened; moved over when it completes
    pendingPosterFileId: text("pending_poster_file_id"),
    event: text("event"),
    uploadedBy: text("uploaded_by").notNull(), // a user id
    createdAt: timestamp("created_at").notNull().defaultNow(),
    readyAt: timestamp("ready_at"),
    removedAt: timestamp("removed_at"),
    removedBy: text("removed_by"),
  },
  (t) => [
    check("assets_kind_check", sql`${t.kind} in ('video', 'image', 'audio')`),
    check("assets_status_check", sql`${t.status} in ('uploading', 'ready')`),
    check("assets_preview_status_check", sql`${t.previewStatus} in ('none', 'pending', 'ready', 'failed')`),
    // One unfinished upload per member and file: choosing the same file again finds it.
    uniqueIndex("assets_unfinished_upload_unique").on(t.spaceId, t.uploadedBy, t.fileName, t.sizeBytes, t.lastModifiedMs).where(sql`${t.status} = 'uploading'`),
    index("assets_created_at_idx").on(t.createdAt),
    index("assets_space_id_idx").on(t.spaceId),
  ],
);

// A person's connected Google account. The refresh token is kept encrypted and never leaves the server.
export const driveConnection = pgTable(
  "drive_connection",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    googleSub: text("google_sub").notNull(), // Google's account id
    email: text("email").notNull(), // shown in settings
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    scopes: text("scopes").notNull(), // space-separated, as Google granted
    brokenAt: timestamp("broken_at"),
    brokenReason: text("broken_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("drive_connection_user_sub_unique").on(t.userId, t.googleSub)],
);

// Where a space keeps its media. Every space has one row once it is set up.
export const spaceStorage = pgTable(
  "space_storage",
  {
    spaceId: text("space_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["shared_folder", "google_account"] }).notNull(),
    connectionId: text("connection_id").references(() => driveConnection.id, { onDelete: "restrict" }), // null for shared_folder
    rootFolderId: text("root_folder_id"), // null for shared_folder: use DRIVE_FOLDER_ID
    folderName: text("folder_name"),
    readerEmail: text("reader_email"), // the team's reader service account; null for personal and shared_folder
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("space_storage_kind_check", sql`${t.kind} in ('shared_folder', 'google_account')`),
    check(
      "space_storage_shape_check",
      sql`(${t.kind} = 'shared_folder' and ${t.connectionId} is null) or (${t.kind} = 'google_account' and ${t.connectionId} is not null and ${t.rootFolderId} is not null)`,
    ),
  ],
);

// A space's brand kit: the fonts its titles, subtitles and body text start in, its colors and its logos (images of
// the space's own media, in the order shown). No row is the default kit (src/lib/brand/service.ts).
export const brandKit = pgTable("brand_kit", {
  spaceId: text("space_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  titleFont: text("title_font").notNull(),
  subtitleFont: text("subtitle_font").notNull(),
  bodyFont: text("body_font").notNull(),
  colors: jsonb("colors").$type<string[]>().notNull().default([]),
  logoAssetIds: jsonb("logo_asset_ids").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"), // an actor id: a person's, or an agent's acting for them
});

// The space each person opened last, so /dashboard takes them back to it.
export const spaceVisits = pgTable("space_visits", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  spaceId: text("space_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  visitedAt: timestamp("visited_at").notNull().defaultNow(),
});

// A member's personal access token for an AI agent that cannot sign in through a browser and sends a header instead.
// Only the sha256 of the token is kept; the token itself is shown once, when it is made. The agent kinds are listed
// here as in AGENT_KINDS (src/lib/connector/agents.ts): adding a kind there needs a migration that widens the check.
export const agentToken = pgTable(
  "agent_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    agent: text("agent").$type<AgentKind>().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    // The token's last 4 characters, so the member can tell their tokens apart.
    preview: text("preview").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [
    check(
      "agent_token_agent_check",
      sql`${t.agent} in ('claude', 'chatgpt', 'claude-code', 'cursor', 'vscode', 'codex', 'gemini-cli', 'openai-api', 'other')`,
    ),
    index("agent_token_user_id_idx").on(t.userId),
  ],
);
