import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { hasOnboarded } from "@/lib/onboarding/state";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { ensurePersonalSpace, lastSpace, listMySpaces, spaceOfFolder } from "@/lib/spaces/service";

const HANDLED_QUERY = ["storage", "youtube", "passkeys", "folder"];

// The old address of the dashboard: a new account goes to /welcome; otherwise on to the space the person used last, with the same query (?passkeys=1 survives
// this way). A ?folder=<id> goes to the folder's own space when the person is a member of it; otherwise it is treated
// like any other query in their last space, where an unknown folder is just the main view, so nothing leaks.
export default async function DashboardRedirect({ searchParams }: PageProps<"/dashboard">): Promise<never> {
  const user = await requireUser();
  const db = getDb();
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(await searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) query[key] = first;
  }
  // A new account is welcomed first, unless the request carries something this page handles (a Drive connect that came back
  // with ?storage=, a YouTube connect with ?youtube=, ?passkeys=1 reopening the dialog, ?folder=): then it goes on like any account, and the welcome comes on
  // the next plain visit. A table or read that fails counts as onboarded: this never blocks the app.
  const carriesQuery = HANDLED_QUERY.some((key) => query[key] !== undefined);
  if (!carriesQuery && !(await hasOnboarded(db, user.id).catch(() => true))) redirect("/welcome");
  if (query.folder) {
    const folderSpace = await spaceOfFolder(db, query.folder);
    const there = folderSpace ? (await listMySpaces(db, user.id)).find((s) => s.id === folderSpace) : undefined;
    if (there) redirect(spacePath(slugFor(there), query));
  }
  await ensurePersonalSpace(db, user); // lastSpace falls back on it
  redirect(spacePath(slugFor(await lastSpace(db, user.id)), query));
}
