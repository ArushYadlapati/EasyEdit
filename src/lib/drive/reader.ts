import { createHash } from "node:crypto";
import { type AccessSource, DriveError, isServiceAccountEmail, reach, refusalReason, retrying } from "./token";

// Each team's reader is a service account of its own, with no key: the app's service account makes it, shares the
// team's folder with it, and asks IAM Credentials for its read-only tokens. A token handed to a team member can then
// read that team's folder and nothing else.

const IAM = "https://iam.googleapis.com/v1/projects";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const ACCOUNT_ID_CHARS = 10;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const bearer = async (source: AccessSource) => ({ Authorization: `Bearer ${(await source.token()).accessToken}` });
const project = (projectId: string) => `${IAM}/${encodeURIComponent(projectId)}/serviceAccounts`;

// "ee-r-" and ten lowercase base36 characters from the space id's SHA-256: the same space always gets the same one,
// and it fits IAM's rule for account ids (6–30 characters, [a-z]([-a-z0-9]*[a-z0-9])).
export function readerAccountId(spaceId: string): string {
  const digest = createHash("sha256").update(spaceId).digest();
  return `ee-r-${(digest.readBigUInt64BE(0) % BigInt(36 ** ACCOUNT_ID_CHARS)).toString(36).padStart(ACCOUNT_ID_CHARS, "0")}`;
}

// Makes the space's reader in the project, or finds it made already (409): either way its address.
// `caller` holds the app's service account token for the Cloud scope.
export async function createReader(deps: { caller: AccessSource; projectId: string; spaceId: string; fetch?: typeof fetch }): Promise<{ email: string }> {
  const accountId = readerAccountId(deps.spaceId);
  const answer = await reach(deps.fetch ?? fetch, "reader", project(deps.projectId), {
    method: "POST",
    headers: { ...(await bearer(deps.caller)), "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ accountId, serviceAccount: { displayName: `EasyEdit reader ${deps.spaceId}`.slice(0, 100) } }),
  });
  const email = `${accountId}@${deps.projectId}.iam.gserviceaccount.com`;
  if (answer.status === 409) return { email };
  if (!answer.ok) throw new DriveError("reader", answer.status, await refusalReason(answer));
  const body: unknown = await answer.json().catch(() => null);
  if (isRecord(body) && body.email !== undefined && body.email !== email) throw new DriveError("reader", answer.status, "unknown");
  return { email };
}

// Removes a reader. One that is already gone is not an error.
export async function deleteReader(deps: { caller: AccessSource; projectId: string; email: string; fetch?: typeof fetch }): Promise<void> {
  if (!isServiceAccountEmail(deps.email)) throw new DriveError("reader", 0, "bad_account"); // it goes into the path as it is
  const answer = await reach(deps.fetch ?? fetch, "reader", `${project(deps.projectId)}/${deps.email}`, { method: "DELETE", headers: await bearer(deps.caller) });
  if (!answer.ok && answer.status !== 404) throw new DriveError("reader", answer.status, await refusalReason(answer));
}

// Lets `email` read the folder and everything in it, without sending anyone an email. `write` is the source that
// can change the folder (the connection that made it). A reader made a moment ago may not be known to Drive yet:
// Drive then answers 400 invalidSharingRequest or 404, and it is asked again after a short wait, a few times.
export async function shareFolderWith(drive: { write: AccessSource; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }, folderId: string, email: string): Promise<void> {
  const fetchFn = drive.fetch ?? fetch;
  const share = async () => {
    const answer = await reach(fetchFn, "share", `${DRIVE}/${encodeURIComponent(folderId)}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, {
      method: "POST",
      headers: { ...(await bearer(drive.write)), "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ role: "reader", type: "user", emailAddress: email }),
    });
    if (!answer.ok) throw new DriveError("share", answer.status, await refusalReason(answer));
  };
  const notYet = (error: unknown) => error instanceof DriveError && error.call === "share" && (error.status === 404 || (error.status === 400 && error.reason === "invalidSharingRequest"));
  await retrying(share, notYet, drive.sleep);
}
