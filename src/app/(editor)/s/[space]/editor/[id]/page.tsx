import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { EditorShell } from "@/components/editor/editor-shell";
import { KeepSignedIn } from "@/components/keep-signed-in";
import { RecordOpen } from "@/components/record-open";
import { getDb } from "@/db";
import { meetsRole, requireUser } from "@/lib/access";
import { LAYOUT_COOKIE, parseLayout } from "@/lib/editor/layout";
import { PREFS_COOKIE, parsePrefs } from "@/lib/editor/settings";
import { projectNameFor } from "@/lib/projects/project-title";
import { getProject } from "@/lib/projects/service";
import { actorIn } from "@/lib/spaces/access";
import { editorPath, slugFor } from "@/lib/spaces/paths";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { findMySpace, listMySpaces, spaceOfProject } from "@/lib/spaces/service";
import { storageState } from "@/lib/spaces/storage";
import { storageBlock } from "@/lib/storage/availability";
import { connectionOwner } from "@/lib/storage/settings-view";
import { stockConfig } from "@/lib/stock/config";
import { editorGuide } from "@/lib/tutorial/guide";

// The editor is always dark. This asks the Dark Reader browser extension to leave the page alone: on a screen that
// is already dark it darkens the few light elements, and the playhead all but disappears. The color scheme tells the
// browser's own dark mode the same (and darkens the page behind the editor, see globals.css).
const DARK_READER_LOCK: Metadata = { other: { "darkreader-lock": "true" } };
export const viewport: Viewport = { colorScheme: "dark" };

// The browser tab names the project: "Summer trip · EasyEdit", with the darkreader lock above (a page may export
// metadata or generateMetadata, not both).
export async function generateMetadata({ params }: PageProps<"/s/[space]/editor/[id]">): Promise<Metadata> {
  const user = await requireUser();
  const { space: slug, id } = await params;
  const name = await projectNameFor(getDb(), user.id, slug, id);
  return name === null ? DARK_READER_LOCK : { ...DARK_READER_LOCK, title: `${name} · EasyEdit` };
}

// The editor fills the window on its own: the (editor) group has no layout, so the site header is not drawn.
export default async function EditorPage({ params }: PageProps<"/s/[space]/editor/[id]">) {
  const user = await requireUser();
  const { space: slug, id } = await params;
  const db = getDb();
  const space = await findMySpace(db, user.id, slug);
  if (!space) notFound();
  const actor = await actorIn(db, user, space.id);
  if (!actor) notFound();
  const project = await getProject(db, actor, id);
  if (!project) {
    // In another space the person belongs to: go there. Anything else reveals nothing.
    const projectSpace = await spaceOfProject(db, id);
    const there = projectSpace && projectSpace !== space.id ? (await listMySpaces(db, user.id)).find((s) => s.id === projectSpace) : undefined;
    if (there) redirect(editorPath(slugFor(there), id));
    notFound();
  }
  // The panel sizes and preferences this browser kept, so the first paint already has them.
  const jar = await cookies();
  const layout = parseLayout(jar.get(LAYOUT_COOKIE)?.value);
  const prefs = parsePrefs(jar.get(PREFS_COOKIE)?.value);
  // Whether the space has storage, from its rows (no Drive call), and if not, what to tell the person: "broken" when
  // its Google connection needs reconnecting, "none" when it has none. Storage this server's settings can't use yet
  // (not_configured) counts as there: the Media tab still lists the library and says uploads are not set up, from
  // its list.
  const storage = await storageState(db, space.id);
  const storageReady = storage.ready || storage.reason === "not_configured";
  const storageProblem = storage.ready ? null : storage.reason === "broken" ? "broken" : storage.reason === "none" ? "none" : null;
  // For the Media tab's setup card: who may set storage up (the space's admins), and whether this server can.
  const isAdmin = actor.role === "admin";
  const block = storageProblem === "none" ? storageBlock(space.kind) : null;
  // Only the person who connected the account can reconnect it; another admin is told who. Only admins are told
  // anything about it: no one else's page carries the owner's address.
  const owner = storageProblem === "broken" && isAdmin ? await connectionOwner(db, space.id) : null;

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
          movedAtVersion: project.movedAtVersion,
        }}
        space={{ id: space.id, slug: slugFor(space), storageReady, storageProblem, kind: space.kind, isAdmin, storageBlock: block, ownsConnection: owner?.userId === user.id, ownerEmail: owner?.email ?? null, stock: stockConfig() !== null, personalSoon: !personalSpacesOpen() }}
        layout={layout}
        prefs={prefs}
        guide={editorGuide()}
      />
    </>
  );
}
