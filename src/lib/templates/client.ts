import type { Template, TemplateSummary } from "./types";

const FAILED = "That did not work. Try again.";

// A refusal from /api/templates, with the server's own code and message (written for people) kept for the page.
export class TemplateApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function check(response: Response): Promise<unknown> {
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const { code, message } = (typeof body === "object" && body !== null ? body : {}) as { code?: unknown; message?: unknown };
    throw new TemplateApiError(
      typeof code === "string" ? code : "UNKNOWN",
      typeof message === "string" ? message : FAILED,
      response.status,
    );
  }
  return body;
}

const base = (spaceId: string, id?: string) => `/api/templates${id ? `/${encodeURIComponent(id)}` : ""}?space=${encodeURIComponent(spaceId)}`;
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export type SaveTemplateInput = { projectId: string; name: string; description?: string; instructions?: string; replace?: boolean };
export type TemplatePatch = { name?: string; description?: string; instructions?: string };

export async function listTemplates(spaceId: string): Promise<TemplateSummary[]> {
  const body = (await check(await fetch(base(spaceId), { cache: "no-store" }))) as { templates?: unknown } | null;
  if (!body || !Array.isArray(body.templates)) throw new TemplateApiError("UNKNOWN", FAILED, 200);
  return body.templates as TemplateSummary[];
}

export async function getTemplate(spaceId: string, id: string): Promise<Template> {
  const body = (await check(await fetch(base(spaceId, id), { cache: "no-store" }))) as { template?: Template } | null;
  if (!body?.template) throw new TemplateApiError("UNKNOWN", FAILED, 200);
  return body.template;
}

export async function saveTemplate(spaceId: string, input: SaveTemplateInput): Promise<{ id: string; replaced: boolean }> {
  const body = (await check(await fetch(base(spaceId), json("POST", input)))) as { id?: unknown; replaced?: unknown } | null;
  if (!body || typeof body.id !== "string") throw new TemplateApiError("UNKNOWN", FAILED, 200);
  return { id: body.id, replaced: body.replaced === true };
}

export async function updateTemplate(spaceId: string, id: string, patch: TemplatePatch): Promise<void> {
  await check(await fetch(base(spaceId, id), json("PATCH", patch)));
}

export async function deleteTemplate(spaceId: string, id: string): Promise<void> {
  await check(await fetch(base(spaceId, id), { method: "DELETE" }));
}
