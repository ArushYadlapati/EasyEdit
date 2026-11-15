import { createHash, createVerify, generateKeyPairSync, randomBytes } from "node:crypto";
import type { DriveConfig } from "@/lib/drive/config";
import { SCOPE_CLOUD, SCOPE_READ, SCOPE_WRITE } from "@/lib/drive/token";

// A pretend Google Drive, in memory. It writes down what the real checks showed (drive-facts.md), so a test
// that passes here says something about the real one. It holds no bytes, only how many arrived: a file read
// back is that many zero bytes.
//
// Beside the shared drive, it holds people's own Drives and the app's IAM project. A token belongs to someone: the
// app's service account (a signed request), a person (a refresh token from `connect`), or a team's reader (made by
// IAM Credentials for the app's service account). The app's service account sees the shared drive, as before. A
// file anyone else made has an `owner`, and is seen by its owner and by whoever one of its folders is shared with,
// except a person's drive.file token, which sees only the files it made.

const TOKEN_HOST = "oauth2.googleapis.com";
const API_HOST = "www.googleapis.com";
const IAM_HOST = "iam.googleapis.com";
const CREDENTIALS_HOST = "iamcredentials.googleapis.com";
const HOSTS = [TOKEN_HOST, API_HOST, IAM_HOST, CREDENTIALS_HOST];
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const SCOPE_FILE = "https://www.googleapis.com/auth/drive.file"; // the only scope a person's connection has
const DRIVE_SCOPES = [SCOPE_WRITE, SCOPE_READ, SCOPE_FILE];
const PROJECT_ID = "easyedit-test"; // the app's Google Cloud project, where readers are made
const DEFAULT_LIMIT_BYTES = 15 * 1024 ** 3; // a free Google account
const ACCOUNT_ID = /^[a-z]([-a-z0-9]*[a-z0-9])$/;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER_ID = "folder1"; // the folder that holds the media
const DRIVE_ID = "drive9"; // the shared drive that folder is in; the service account is not a member of it
const TOKEN_LIFE_MS = 3_600_000;
const PIECE_MULTIPLE = 262_144; // every piece but the last is a multiple of 256 KiB
const DEFAULT_FIELDS = ["kind", "id", "name", "mimeType"]; // what Drive reports about a file when not asked for more

// One real key for all the fakes of a test file: making one takes a while.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

// owner: who made it, when it is in someone's own Drive. None: it is in the shared drive.
type FakeFile = { name: string; parents: string[]; sizeBytes: number; mimeType: string; trashed: boolean; owner?: string };
type FakeSession = { fileId: string; sizeBytes: number; received: number; origin: string | null; name: string; parentId: string; mimeType: string; owner?: string };
type Role = "reader" | "writer";
type Holder = { email: string; scope: string };

export type FakeDrive = {
  fetch: typeof fetch; // answers oauth2, www, iam and iamcredentials .googleapis.com; anything else throws
  config: DriveConfig; // a real RSA key made for the test; rootFolderId "folder1" (the folder that holds the media; every file and folder the fake holds reports driveId "drive9", a different value, as the real Drive does)
  files: Map<string, FakeFile>;
  sessions: Map<string, FakeSession>;
  calls: { method: string; path: string; scope: string | null; origin: string | null }[]; // path: without the host or the query. scope: of the token the call carried
  projectId: string; // "easyedit-test", the project in config.clientEmail
  // A person who connected their Drive: their refresh token (made up unless given) gets tokens for drive.file as `email`.
  connect(input?: { email?: string; refreshToken?: string }): { refreshToken: string; email: string };
  revoke(refreshToken: string): void; // the person removed the app's access: the refresh token answers invalid_grant, its tokens stop working
  accounts: Map<string, { accountId: string; displayName: string }>; // the service accounts IAM made, by address
  addServiceAccount(accountId: string): string; // as if IAM had made it; its address
  shares: Map<string, Map<string, Role>>; // file id → address → role
  permissionRequests: { fileId: string; query: Record<string, string>; body: unknown }[]; // every permissions.create that reached the fake
  impersonations: { caller: string; callerToken: string; target: string; scope: string[]; lifetime: string }[]; // every token IAM Credentials gave
  whoHas(accessToken: string): Holder | null; // whose token it is and for what, while it still works
  setQuota(email: string, quota: { limitBytes: number | null; usedBytes?: number }): void; // what about.get says; else 15 GiB, and the sizes of their files
  failNext(match: RegExp, status: number, reason?: string): void; // the next call whose "METHOD path?query" matches is answered so; calls queue up
  dropNextPieceAfter(bytes: number): void; // the next piece keeps this many bytes, then the connection fails
  expireSessions(): void; // every open session now answers 404
  advance(ms: number): void;
  now(): number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const newId = () => `1${randomBytes(24).toString("base64url")}`;
const sessionAddress = (uploadId: string) => `https://${API_HOST}/upload/drive/v3/files?uploadType=resumable&upload_id=${uploadId}`;

// A refusal in the shape the Drive API gives one.
const refusal = (status: number, reason?: string) =>
  Response.json({ error: { code: status, message: "The pretend Drive refused this call.", errors: reason ? [{ domain: "global", reason }] : [] } }, { status });

const sizeOf = async (body: BodyInit | null): Promise<number> => {
  if (body === null) return 0;
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength;
  return (await new Response(body).arrayBuffer()).byteLength;
};

const jsonOf = async (headers: Headers, body: BodyInit | null): Promise<Record<string, unknown> | null> => {
  if (!(headers.get("content-type") ?? "").startsWith("application/json")) return null;
  const value: unknown = await new Response(body).json().catch(() => null);
  return isRecord(value) ? value : null;
};

const QUERY_TERM = /^(?:name = '((?:[^'\\]|\\.)*)'|mimeType = '((?:[^'\\]|\\.)*)'|'((?:[^'\\]|\\.)*)' in parents|trashed = (true|false))(?: and (?=.)|$)/;
const unescaped = (text: string) => text.replace(/\\(.)/g, "$1");

// The tests of a list's `q`, for the four kinds of term the app may write. null for anything else.
function readQuery(q: string): ((file: FakeFile) => boolean)[] | null {
  const tests: ((file: FakeFile) => boolean)[] = [];
  let rest = q;
  while (rest !== "") {
    const term = QUERY_TERM.exec(rest);
    if (!term) return null;
    const [whole, name, mimeType, parent, trashed] = term;
    if (name !== undefined) tests.push((file) => file.name === unescaped(name));
    else if (mimeType !== undefined) tests.push((file) => file.mimeType === unescaped(mimeType));
    else if (parent !== undefined) tests.push((file) => file.parents.includes(unescaped(parent)));
    else tests.push((file) => file.trashed === (trashed === "true"));
    rest = rest.slice(whole.length);
  }
  return tests;
}

export function makeFakeDrive(): FakeDrive {
  let clock = Date.now();
  let dropAfter: number | null = null;
  const failures: { match: RegExp; status: number; reason?: string }[] = [];
  const tokens = new Map<string, Holder & { expiresAt: number; refreshToken?: string }>();
  const connections = new Map<string, { email: string; revoked: boolean }>();
  const accounts: FakeDrive["accounts"] = new Map();
  const shares: FakeDrive["shares"] = new Map();
  const permissionRequests: FakeDrive["permissionRequests"] = [];
  const impersonations: FakeDrive["impersonations"] = [];
  const quotas = new Map<string, { limitBytes: number | null; usedBytes?: number }>();
  let people = 0;
  const expired = new Set<string>();
  const canceled = new Set<string>();

  const config: DriveConfig = { clientEmail: "easyedit-media@easyedit-test.iam.gserviceaccount.com", privateKey, rootFolderId: ROOT_FOLDER_ID };
  const files: FakeDrive["files"] = new Map([[ROOT_FOLDER_ID, { name: "EasyEdit", parents: [], sizeBytes: 0, mimeType: FOLDER_MIME, trashed: false }]]);
  const sessions: FakeDrive["sessions"] = new Map();
  const calls: FakeDrive["calls"] = [];

  // A file as Drive reports it, cut down to the fields asked for. A size is a string, and a folder has none.
  function report(id: string, fields: string[]): Record<string, unknown> {
    const file = files.get(id)!;
    const all: Record<string, unknown> = { kind: "drive#file", id, name: file.name, mimeType: file.mimeType, parents: file.parents, ...(inSharedDrive(file) ? { driveId: DRIVE_ID } : {}), trashed: file.trashed };
    if (file.mimeType !== FOLDER_MIME) all.size = String(file.sizeBytes);
    return Object.fromEntries(fields.filter((field) => field in all).map((field) => [field, all[field]]));
  }

  const isOpenFolder = (id: unknown): id is string => typeof id === "string" && files.get(id)?.mimeType === FOLDER_MIME && !files.get(id)!.trashed;
  const inSharedDrive = (file: FakeFile) => file.owner === undefined;
  const isPerson = (email: string) => [...connections.values()].some((person) => person.email === email);
  const isMainAccount = (email: string) => email === config.clientEmail;

  // The strongest role `email` has on the file through it or any folder it is in.
  function roleOn(id: string, email: string, seen = new Set<string>()): Role | null {
    if (seen.has(id)) return null;
    seen.add(id);
    let role: Role | null = shares.get(id)?.get(email) ?? null;
    for (const parent of files.get(id)?.parents ?? []) {
      if (role === "writer") break;
      role = roleOn(parent, email, seen) ?? role;
    }
    return role;
  }
  // The app's service account sees the whole shared drive; a file in someone's Drive is seen by its owner and whoever it is shared with.
  // A person's token is for drive.file: it reaches only what the app made with that person's connection, never a file
  // merely shared with their address. A reader (a service account) reaches what is shared with it.
  function canSee(who: Holder, id: string): boolean {
    const file = files.get(id);
    if (!file) return false;
    if (inSharedDrive(file) && isMainAccount(who.email)) return true;
    if (who.scope === SCOPE_FILE) return file.owner === who.email;
    return file.owner === who.email || roleOn(id, who.email) !== null;
  }
  function canChange(who: Holder, id: string): boolean {
    const file = files.get(id);
    if (!file || who.scope === SCOPE_READ) return false;
    if (inSharedDrive(file) && isMainAccount(who.email)) return true;
    if (who.scope === SCOPE_FILE) return file.owner === who.email;
    return file.owner === who.email || roleOn(id, who.email) === "writer";
  }
  // Whose token it is, while it still works: not expired, and its holder not deleted or cut off.
  function holder(accessToken: string): (Holder & { expiresAt: number }) | null {
    const token = tokens.get(accessToken);
    if (!token || clock >= token.expiresAt) return null;
    if (token.refreshToken !== undefined && connections.get(token.refreshToken)?.revoked !== false) return null;
    if (!isMainAccount(token.email) && !isPerson(token.email) && !accounts.has(token.email)) return null;
    return token;
  }
  function give(holderOf: Holder, lifeMs: number, refreshToken?: string): { accessToken: string; expiresAt: number } {
    const accessToken = `ya29.fake-${randomBytes(18).toString("base64url")}`;
    const expiresAt = clock + lifeMs;
    tokens.set(accessToken, { ...holderOf, expiresAt, ...(refreshToken === undefined ? {} : { refreshToken }) });
    return { accessToken, expiresAt };
  }

  // The token endpoint: checks the signed request against the key, or the refresh token against the people who
  // connected, and remembers whose each token is and for which scope.
  async function issueToken(body: BodyInit | null): Promise<Response> {
    const form = new URLSearchParams(await new Response(body).text());
    if (form.get("grant_type") === "refresh_token") return refresh(form);
    if (form.get("grant_type") !== GRANT_TYPE) return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
    const [head, claims, signature] = (form.get("assertion") ?? "").split(".");
    const signed = head && claims && signature ? createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, signature, "base64url") : false;
    if (!signed) return Response.json({ error: "invalid_grant" }, { status: 400 });
    const { iss, scope } = JSON.parse(Buffer.from(claims, "base64url").toString()) as Record<string, unknown>;
    if (iss !== config.clientEmail) return Response.json({ error: "invalid_grant" }, { status: 400 });
    if (scope !== SCOPE_WRITE && scope !== SCOPE_READ && scope !== SCOPE_CLOUD) return Response.json({ error: "invalid_scope" }, { status: 400 });
    const { accessToken } = give({ email: config.clientEmail, scope }, TOKEN_LIFE_MS);
    return Response.json({ access_token: accessToken, expires_in: TOKEN_LIFE_MS / 1000, token_type: "Bearer" });
  }

  function refresh(form: URLSearchParams): Response {
    if (!form.get("client_id") || !form.get("client_secret")) return Response.json({ error: "invalid_client" }, { status: 401 });
    const refreshToken = form.get("refresh_token") ?? "";
    const person = connections.get(refreshToken);
    if (!person || person.revoked) return Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });
    const { accessToken } = give({ email: person.email, scope: SCOPE_FILE }, TOKEN_LIFE_MS, refreshToken);
    return Response.json({ access_token: accessToken, expires_in: TOKEN_LIFE_MS / 1000, scope: SCOPE_FILE, token_type: "Bearer" });
  }

  function generateIds(params: URLSearchParams): Response {
    const count = Number(params.get("count") ?? 10);
    return Response.json({ kind: "drive#generatedIds", space: "drive", ids: Array.from({ length: count }, newId) });
  }

  function list(who: Holder, params: URLSearchParams): Response {
    // The folder is shared, the drive is not: asking by drive is refused (fact 2).
    if (params.get("corpora") === "drive" || params.has("driveId")) return refusal(403, "teamDriveMembershipRequired");
    const tests = readQuery(params.get("q") ?? "");
    const fields = /^files\(([\w,]+)\)$/.exec(params.get("fields") ?? `files(${DEFAULT_FIELDS.join(",")})`)?.[1].split(",");
    const orderBy = params.get("orderBy");
    if (!tests || !fields || (orderBy !== null && orderBy !== "createdTime" && orderBy !== "createdTime desc")) return refusal(400, "invalid");
    // Without both flags, files in a shared drive are not listed at all (fact 5). A person's own files are.
    const seesSharedDrives = params.get("supportsAllDrives") === "true" && params.get("includeItemsFromAllDrives") === "true";
    const found = [...files]
      .filter(([id, file]) => (seesSharedDrives || !inSharedDrive(file)) && canSee(who, id) && tests.every((test) => test(file)))
      .map(([id]) => id);
    // The map keeps files in the order they were made. Drive promises no order unless asked for one; the fake
    // then gives the newest first, so that a caller who forgot to ask is found out.
    if (orderBy !== "createdTime") found.reverse();
    return Response.json({ files: found.map((id) => report(id, fields)) });
  }

  // Whether `who` may put a file in `parent`: a 404 or 403 when not, null when it may.
  function placeRefused(who: Holder, parent: unknown, params: URLSearchParams): Response | null {
    if (!isOpenFolder(parent) || !canSee(who, parent)) return refusal(404, "notFound");
    if (inSharedDrive(files.get(parent)!) && params.get("supportsAllDrives") !== "true") return refusal(404, "notFound");
    return canChange(who, parent) ? null : refusal(403, "insufficientFilePermissions");
  }
  // Who a new file in `parent` belongs to: nobody in the shared drive, else whoever made it.
  const ownerIn = (who: Holder, parent: string | undefined) => (parent !== undefined && inSharedDrive(files.get(parent)!) ? {} : { owner: who.email });

  async function createFile(who: Holder, params: URLSearchParams, headers: Headers, body: BodyInit | null): Promise<Response> {
    const meta = await jsonOf(headers, body);
    if (!meta || typeof meta.name !== "string") return refusal(400, "badRequest");
    const parent = Array.isArray(meta.parents) ? meta.parents[0] : undefined;
    // A person may make a file at the top of their own Drive, with no parent.
    const refused = parent === undefined && isPerson(who.email) ? null : placeRefused(who, parent, params);
    if (refused) return refused;
    const id = newId();
    const parents = typeof parent === "string" ? [parent] : [];
    files.set(id, { name: meta.name, parents, sizeBytes: 0, mimeType: typeof meta.mimeType === "string" ? meta.mimeType : "application/octet-stream", trashed: false, ...ownerIn(who, parents[0]) });
    return Response.json(report(id, params.get("fields")?.split(",") ?? DEFAULT_FIELDS));
  }

  async function oneFile(who: Holder, method: string, id: string, params: URLSearchParams, headers: Headers, body: BodyInit | null): Promise<Response> {
    const file = files.get(id);
    // A file in a shared drive is not there for a caller that does not say it knows about shared drives.
    // And this member may not delete for good: that is answered 404 too (fact 6).
    if (!file || !canSee(who, id) || (inSharedDrive(file) && params.get("supportsAllDrives") !== "true") || method === "DELETE") return refusal(404, "notFound");
    if (method === "PATCH") {
      if (!canChange(who, id)) return refusal(403, "insufficientFilePermissions");
      const change = await jsonOf(headers, body);
      if (!change) return refusal(400, "badRequest");
      if (typeof change.name === "string") file.name = change.name;
      if (typeof change.trashed === "boolean") file.trashed = change.trashed;
    } else if (method !== "GET") {
      return refusal(404, "notFound");
    }
    // The file itself and not its facts: as many zero bytes as it has. That the answer says how long it is has
    // not been seen in a real check; a reader must not depend on it.
    if (params.get("alt") === "media") return new Response(new Uint8Array(file.sizeBytes), { status: 200, headers: { "Content-Type": file.mimeType, "Content-Length": String(file.sizeBytes) } });
    return Response.json(report(id, params.get("fields")?.split(",") ?? DEFAULT_FIELDS));
  }

  // permissions.create. Sharing with a service account address that IAM does not know is refused as Drive refuses
  // sharing with an address that has no Google account, when no email is sent.
  async function share(who: Holder, id: string, params: URLSearchParams, headers: Headers, body: BodyInit | null): Promise<Response> {
    const file = files.get(id);
    if (!file || !canSee(who, id) || (inSharedDrive(file) && params.get("supportsAllDrives") !== "true")) return refusal(404, "notFound");
    if (!canChange(who, id)) return refusal(403, "insufficientFilePermissions");
    const wanted = await jsonOf(headers, body);
    permissionRequests.push({ fileId: id, query: Object.fromEntries(params), body: wanted });
    const { role, type, emailAddress } = wanted ?? {};
    if ((role !== "reader" && role !== "writer") || type !== "user" || typeof emailAddress !== "string") return refusal(400, "invalid");
    const known = isMainAccount(emailAddress) || accounts.has(emailAddress) || !emailAddress.endsWith(".iam.gserviceaccount.com");
    if (!known) return refusal(400, "invalidSharingRequest");
    const onFile = shares.get(id) ?? new Map<string, Role>();
    onFile.set(emailAddress, role);
    shares.set(id, onFile);
    return Response.json({ kind: "drive#permission", id: `perm-${createHash("sha256").update(emailAddress).digest("hex").slice(0, 12)}`, type, role });
  }

  // about.get, for the storage quota of the token's holder. `fields` must be given, as the real one says.
  function about(who: Holder, params: URLSearchParams): Response {
    const fields = params.get("fields");
    if (!fields) return refusal(400, "required");
    if (!fields.split(",").includes("storageQuota")) return Response.json({});
    const owned = [...files.values()].filter((file) => file.owner === who.email && file.mimeType !== FOLDER_MIME);
    const set = quotas.get(who.email);
    const limitBytes = set ? set.limitBytes : DEFAULT_LIMIT_BYTES;
    const used = set?.usedBytes ?? owned.filter((file) => !file.trashed).reduce((sum, file) => sum + file.sizeBytes, 0);
    const trash = set?.usedBytes !== undefined ? 0 : owned.filter((file) => file.trashed).reduce((sum, file) => sum + file.sizeBytes, 0);
    return Response.json({
      storageQuota: { ...(limitBytes === null ? {} : { limit: String(limitBytes) }), usage: String(used + trash), usageInDrive: String(used + trash), usageInDriveTrash: String(trash) },
    });
  }

  async function openSession(who: Holder, params: URLSearchParams, headers: Headers, body: BodyInit | null): Promise<Response> {
    const meta = await jsonOf(headers, body);
    const length = headers.get("x-upload-content-length") ?? "";
    if (params.get("uploadType") !== "resumable" || !meta || typeof meta.name !== "string" || !/^\d+$/.test(length)) return refusal(400, "badRequest");
    const parentId = Array.isArray(meta.parents) ? meta.parents[0] : undefined;
    const refused = placeRefused(who, parentId, params);
    if (refused || !isOpenFolder(parentId)) return refused ?? refusal(404, "notFound");
    const origin = headers.get("origin");
    const address = sessionAddress(randomBytes(18).toString("base64url"));
    sessions.set(address, {
      fileId: typeof meta.id === "string" ? meta.id : newId(),
      sizeBytes: Number(length),
      received: 0,
      origin,
      name: meta.name,
      parentId,
      mimeType: typeof meta.mimeType === "string" ? meta.mimeType : (headers.get("x-upload-content-type") ?? "application/octet-stream"),
      ...ownerIn(who, parentId),
    });
    return new Response(null, { status: 200, headers: { Location: address, ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) } });
  }

  // A request to a session address. The address is the permission: no token is looked at.
  async function toSession(method: string, address: string, headers: Headers, body: BodyInit | null): Promise<Response> {
    // A page of any origin may ask (fact 10).
    if (method === "OPTIONS") {
      return new Response(null, { status: 200, headers: { "Access-Control-Allow-Origin": headers.get("origin") ?? "null", "Access-Control-Allow-Methods": "PUT", "Access-Control-Allow-Headers": "content-type,content-range" } });
    }
    const session = sessions.get(address);
    if (!session) return new Response(null, { status: 308 }); // an address Drive never gave out is not answered 404 (fact 20)
    if (canceled.has(address)) return new Response(null, { status: 499 });
    if (method === "DELETE") {
      canceled.add(address);
      return new Response(null, { status: 499 }); // what canceling answered (fact 11)
    }
    if (expired.has(address)) return new Response(null, { status: 404 });
    if (method !== "PUT") return refusal(400, "badRequest");

    // A page can read the answer only when the session was opened with its origin (fact 9).
    const cors = { "Access-Control-Allow-Origin": session.origin ?? "null", "Access-Control-Expose-Headers": "Range" };
    const finished = () => session.received === session.sizeBytes;
    const whereItIs = () =>
      finished()
        ? Response.json({ id: session.fileId }, { status: 200, headers: cors })
        : new Response(null, { status: 308, headers: session.received > 0 ? { ...cors, Range: `bytes=0-${session.received - 1}` } : cors });
    const receive = (bytes: number) => {
      session.received += bytes;
      if (finished()) {
        const owner = session.owner === undefined ? {} : { owner: session.owner };
        files.set(session.fileId, { name: session.name, parents: [session.parentId], sizeBytes: session.sizeBytes, mimeType: session.mimeType, trashed: false, ...owner });
      }
    };

    const range = headers.get("content-range") ?? "";
    const question = /^bytes \*\/(\d+)$/.exec(range);
    if (question) return Number(question[1]) === session.sizeBytes ? whereItIs() : refusal(400, "badRequest");
    const part = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (!part) return refusal(400, "badRequest");
    const [from, last, total] = part.slice(1).map(Number);
    const length = last - from + 1;
    const wellFormed = total === session.sizeBytes && last < total && length > 0 && (await sizeOf(body)) === length && (last + 1 === total || length % PIECE_MULTIPLE === 0);
    const inPlace = wellFormed && !finished() && from === session.received; // anything else is a repeat or a gap, and nothing of it is kept
    if (dropAfter !== null) {
      if (inPlace) receive(Math.min(dropAfter, length));
      dropAfter = null;
      throw new TypeError("fetch failed");
    }
    if (!wellFormed) return refusal(400, "badRequest");
    if (inPlace) receive(length);
    return whereItIs();
  }

  // A refusal in the shape IAM gives one: a status name and no list of reasons.
  const iamRefusal = (code: number, status: string) => Response.json({ error: { code, message: "The pretend IAM refused this call.", status } }, { status: code });
  // Only the app's service account, with a token for the Cloud scope, may use IAM.
  function iamRefused(who: Holder | null): Response | null {
    if (!who) return iamRefusal(401, "UNAUTHENTICATED");
    return isMainAccount(who.email) && who.scope === SCOPE_CLOUD ? null : iamRefusal(403, "PERMISSION_DENIED");
  }

  // IAM: serviceAccounts.create and serviceAccounts.delete in the app's project.
  async function iam(who: Holder | null, method: string, path: string, headers: Headers, body: BodyInit | null): Promise<Response> {
    const refused = iamRefused(who);
    if (refused) return refused;
    const at = /^\/v1\/projects\/([^/]+)\/serviceAccounts(?:\/([^/]+))?$/.exec(path);
    if (!at) return iamRefusal(404, "NOT_FOUND");
    if (decodeURIComponent(at[1]) !== PROJECT_ID) return iamRefusal(403, "PERMISSION_DENIED");
    const email = at[2] === undefined ? null : decodeURIComponent(at[2]);
    if (email === null && method === "POST") {
      const asked = await jsonOf(headers, body);
      const accountId = asked?.accountId;
      const displayName = isRecord(asked?.serviceAccount) && typeof asked.serviceAccount.displayName === "string" ? asked.serviceAccount.displayName : "";
      if (typeof accountId !== "string" || accountId.length < 6 || accountId.length > 30 || !ACCOUNT_ID.test(accountId)) return iamRefusal(400, "INVALID_ARGUMENT");
      const made = `${accountId}@${PROJECT_ID}.iam.gserviceaccount.com`;
      if (accounts.has(made)) return iamRefusal(409, "ALREADY_EXISTS");
      accounts.set(made, { accountId, displayName });
      return Response.json({ name: `projects/${PROJECT_ID}/serviceAccounts/${made}`, projectId: PROJECT_ID, uniqueId: String(100_000 + accounts.size), email: made, displayName });
    }
    if (email !== null && method === "DELETE") {
      if (!accounts.delete(email)) return iamRefusal(404, "NOT_FOUND");
      return Response.json({});
    }
    return iamRefusal(404, "NOT_FOUND");
  }

  // IAM Credentials: generateAccessToken for one of the project's service accounts, asked for by the app's.
  async function generateAccessToken(who: Holder | null, callerToken: string, path: string, headers: Headers, body: BodyInit | null): Promise<Response> {
    const refused = iamRefused(who);
    if (refused) return refused;
    const target = /^\/v1\/projects\/-\/serviceAccounts\/([^/:]+):generateAccessToken$/.exec(path)?.[1];
    if (target === undefined) return iamRefusal(404, "NOT_FOUND");
    const email = decodeURIComponent(target);
    if (!accounts.has(email)) return iamRefusal(404, "NOT_FOUND");
    const asked = await jsonOf(headers, body);
    const scope = Array.isArray(asked?.scope) ? asked.scope : [];
    const lifetime = typeof asked?.lifetime === "string" ? asked.lifetime : "3600s";
    const seconds = /^(\d+)s$/.exec(lifetime)?.[1];
    if (scope.length !== 1 || !DRIVE_SCOPES.includes(scope[0]) || seconds === undefined || Number(seconds) < 1 || Number(seconds) > 3600) return iamRefusal(400, "INVALID_ARGUMENT");
    impersonations.push({ caller: who!.email, callerToken, target: email, scope, lifetime });
    const { accessToken, expiresAt } = give({ email, scope: scope[0] }, Number(seconds) * 1000);
    return Response.json({ accessToken, expireTime: new Date(expiresAt).toISOString() });
  }

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const asked = input instanceof Request ? input : null;
    const url = new URL(asked ? asked.url : String(input));
    if (!HOSTS.includes(url.host)) throw new Error(`The pretend Drive does not answer ${url.host}.`);
    const method = (init?.method ?? asked?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? asked?.headers);
    const body: BodyInit | null = init?.body ?? (asked?.body ? await asked.arrayBuffer() : null);
    const params = url.searchParams;

    const bearer = /^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1] ?? "";
    const token = tokens.get(bearer);
    calls.push({ method, path: url.pathname, scope: token?.scope ?? null, origin: headers.get("origin") });

    const planned = failures.findIndex((failure) => failure.match.test(`${method} ${url.pathname}${url.search}`));
    if (planned >= 0) {
      const [failure] = failures.splice(planned, 1);
      return refusal(failure.status, failure.reason);
    }

    if (url.host === TOKEN_HOST) return method === "POST" && url.pathname === "/token" ? issueToken(body) : refusal(404, "notFound");
    if (url.host === IAM_HOST) return iam(holder(bearer), method, url.pathname, headers, body);
    if (url.host === CREDENTIALS_HOST) return method === "POST" ? generateAccessToken(holder(bearer), bearer, url.pathname, headers, body) : iamRefusal(404, "NOT_FOUND");

    const uploadId = url.pathname === "/upload/drive/v3/files" ? params.get("upload_id") : null;
    if (uploadId !== null) return toSession(method, sessionAddress(uploadId), headers, body);

    // Everything else needs a token the fake gave out that still works (an hour, unless IAM gave a shorter one), for
    // Drive; one that can only read may only GET.
    const who = holder(bearer);
    if (!who) return refusal(401, "authError");
    if (!DRIVE_SCOPES.includes(who.scope)) return refusal(403, "insufficientPermissions");
    if (who.scope === SCOPE_READ && method !== "GET") return refusal(403, "insufficientPermissions");

    if (url.pathname === "/upload/drive/v3/files" && method === "POST") return openSession(who, params, headers, body);
    if (url.pathname === "/drive/v3/files/generateIds" && method === "GET") return generateIds(params);
    if (url.pathname === "/drive/v3/files" && method === "GET") return list(who, params);
    if (url.pathname === "/drive/v3/files" && method === "POST") return createFile(who, params, headers, body);
    if (url.pathname === "/drive/v3/about" && method === "GET") return about(who, params);
    const permissionsOf = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(url.pathname)?.[1];
    if (permissionsOf !== undefined && method === "POST") return share(who, decodeURIComponent(permissionsOf), params, headers, body);
    const fileId = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    if (fileId !== undefined) return oneFile(who, method, decodeURIComponent(fileId), params, headers, body);
    return refusal(404, "notFound");
  }) as typeof fetch;

  return {
    fetch: fetchFn,
    config,
    files,
    sessions,
    calls,
    failNext: (match, status, reason) => void failures.push({ match, status, reason }),
    dropNextPieceAfter: (bytes) => void (dropAfter = bytes),
    expireSessions: () => {
      for (const [address, session] of sessions) if (session.received < session.sizeBytes) expired.add(address);
    },
    advance: (ms) => void (clock += ms),
    now: () => clock,
    projectId: PROJECT_ID,
    connect(input = {}) {
      people += 1;
      const email = input.email ?? `person${people}@gmail.com`;
      const refreshToken = input.refreshToken ?? `1//fake-${randomBytes(18).toString("base64url")}`;
      connections.set(refreshToken, { email, revoked: false });
      return { refreshToken, email };
    },
    revoke(refreshToken) {
      const person = connections.get(refreshToken);
      if (person) person.revoked = true;
    },
    accounts,
    addServiceAccount(accountId) {
      const email = `${accountId}@${PROJECT_ID}.iam.gserviceaccount.com`;
      accounts.set(email, { accountId, displayName: accountId });
      return email;
    },
    shares,
    permissionRequests,
    impersonations,
    whoHas(accessToken) {
      const found = holder(accessToken);
      return found ? { email: found.email, scope: found.scope } : null;
    },
    setQuota: (email, quota) => void quotas.set(email, quota),
  };
}

// One piece of an upload, as a browser sends it: `PUT url` with `Content-Range: bytes <from>-<to - 1>/<size>` and `to - from` zero bytes.
export function piece(fake: FakeDrive, url: string, from: number, to: number, size: number): Promise<Response> {
  return fake.fetch(url, { method: "PUT", headers: { "Content-Range": `bytes ${from}-${to - 1}/${size}` }, body: new Uint8Array(to - from) });
}
