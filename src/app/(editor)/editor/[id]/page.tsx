import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { EditorShell } from "@/components/editor/editor-shell";
import { KeepSignedIn } from "@/components/keep-signed-in";
import { RecordOpen } from "@/components/record-open";
import { getDb } from "@/db";
import { meetsRole, requireUser } from "@/lib/access";
import { LAYOUT_COOKIE, parseLayout } from "@/lib/editor/layout";
import { PREFS_COOKIE, parsePrefs } from "@/lib/editor/settings";
import { getProject } from "@/lib/projects/service";
import { actorIn } from "@/lib/spaces/access";
import { driveFor } from "@/lib/spaces/storage";
import { SEED_TEAM_ID } from "@/lib/spaces/types";

// The editor is always dark. This asks the Dark Reader browser extension to leave the page alone: on a screen that
// is already dark it darkens the few light elements, and the playhead all but disappears. The color scheme tells the
// browser's own dark mode the same (and darkens the page behind the editor, see globals.css).
export const metadata: Metadata = { other: { "darkreader-lock": "true" } };
export const viewport: Viewport = { colorScheme: "dark" };

// The editor fills the window on its own: the (editor) group has no layout, so the site header is not drawn.
export default async function EditorPage({ params }: PageProps<"/editor/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  // stage-1: space comes from Task 8
  const actor = await actorIn(db, user, SEED_TEAM_ID);
  if (!actor) notFound();
  const project = await getProject(db, actor, id);
  if (!project) notFound();
  // The panel sizes and preferences this browser kept, so the first paint already has them.
  const jar = await cookies();
  const layout = parseLayout(jar.get(LAYOUT_COOKIE)?.value);
  const prefs = parsePrefs(jar.get(PREFS_COOKIE)?.value);

  return (
    <>
      <KeepSignedIn />
      <RecordOpen projectId={project.id} />
      <EditorShell
        key={project.id}
        initial={{
          projectId: project.id,
          name: project.name,
          doc: project.doc,
          version: project.version,
          me: { id: user.id, name: user.name },
          canEdit: meetsRole(actor.role, "editor"),
          thumbnailVersion: project.thumbnailVersion,
        }}
        space={{ id: actor.spaceId, storageReady: driveFor(actor.spaceId) !== null }}
        layout={layout}
        prefs={prefs}
      />
    </>
  );
}
