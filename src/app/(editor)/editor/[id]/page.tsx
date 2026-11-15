import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { editorPath, slugFor } from "@/lib/spaces/paths";
import { listMySpaces, spaceOfProject } from "@/lib/spaces/service";

// The old address of the editor: on to the project's space when the person is a member of it, otherwise a plain 404.
export default async function EditorRedirect({ params }: PageProps<"/editor/[id]">): Promise<never> {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const spaceId = await spaceOfProject(db, id);
  const space = spaceId ? (await listMySpaces(db, user.id)).find((s) => s.id === spaceId) : undefined;
  if (!space) notFound();
  redirect(editorPath(slugFor(space), id));
}
