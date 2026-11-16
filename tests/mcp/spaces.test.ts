import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import { actorForProject, actorInSpace } from "@/lib/mcp/context";
import { addMediaTool } from "@/lib/mcp/tools/add-media";
import { createProjectTool } from "@/lib/mcp/tools/create-project";
import { editTimelineTool } from "@/lib/mcp/tools/edit-timeline";
import { fetchTool } from "@/lib/mcp/tools/fetch";
import { getProjectTool } from "@/lib/mcp/tools/get-project";
import { listAssetsTool } from "@/lib/mcp/tools/list-assets";
import { listProjectsTool } from "@/lib/mcp/tools/list-projects";
import { searchTool } from "@/lib/mcp/tools/search";
import { undoChangeTool } from "@/lib/mcp/tools/undo-change";
import { agentActorId } from "@/lib/projects/display-actor";
import { applyProjectOps, createProject, getProject, listProjects } from "@/lib/projects/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import type { OpInput } from "@/lib/timeline";
import { testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { insertAsset } from "../media/context";
import { addText, toolContext } from "./context";

const ELSEWHERE = "team_elsewhere";
const elsewhere = testActor({ userId: "u9", email: "u9@gmail.com", role: "admin", spaceId: ELSEWHERE });

// A team Ada is not in, with one project and one asset.
async function otherTeam(db: DB) {
  await db.insert(user).values({ id: "u9", name: "Eve", email: "u9@gmail.com", emailVerified: true });
  await db.execute(sql`insert into organization (id, name, slug, created_at, kind) values (${ELSEWHERE}, 'Elsewhere', 'elsewhere', now(), 'team')`);
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at) values ('m9', ${ELSEWHERE}, 'u9', 'admin', now())`);
  const project = await createProject(db, elsewhere, { name: "Secret reel", format: "short_9x16" });
  const asset = await insertAsset(db, { spaceId: ELSEWHERE, name: "Secret clip", uploadedBy: "u9" });
  return { project: project.id, asset };
}

describe("agents across spaces", () => {
  it("list_projects shows both spaces, labelled", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const personal = testActor({ userId: "u1", spaceId: personalSpaceId("u1") });
    const mine = await createProject(db, personal, { name: "Home movie", format: "square_1x1" });
    const team = await createProject(db, ctx.actor, { name: "Qualifier", format: "short_9x16" });
    await otherTeam(db);

    const { text, isError } = await listProjectsTool(ctx, {});
    expect(isError).toBe(false);
    const lines = text.split("\n");
    expect(lines[1]).toBe('Spaces: "Personal" (personal, admin), "Seattle Solvers" (seattle-solvers, editor). You can change projects in every space you belong to. Name a space in create_project\'s space.');
    expect(lines.find((l) => l.startsWith(mine.id))).toMatch(/ {2}Space: "Personal"$/);
    expect(lines.find((l) => l.startsWith(team.id))).toMatch(/ {2}Space: "Seattle Solvers"$/);
    expect(text).not.toContain("Secret reel");
    expect(text).toContain("2 projects, most recently changed first:");
  });

  it("list_assets and search label the space of each result", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    await insertAsset(db, { name: "Team clip" });
    await insertAsset(db, { spaceId: personalSpaceId("u1"), name: "Home clip" });
    await otherTeam(db);

    const assets = (await listAssetsTool(ctx, {})).text;
    expect(assets).toMatch(/"Team clip".* Space: "Seattle Solvers"/);
    expect(assets).toMatch(/"Home clip".* Space: "Personal"/);
    expect(assets).not.toContain("Secret clip");

    const found = JSON.parse((await searchTool(ctx, { query: "clip" })).text).results.map((r: { title: string }) => r.title).sort();
    expect(found).toEqual(['Home clip (Space: "Personal")', 'Team clip (Space: "Seattle Solvers")']);
  });

  it("create_project asks which space when none is named, and accepts space: 'personal' or 'seattle-solvers'", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const mine = await createProjectTool(ctx, { name: "Solo", format: "short_9x16", space: "personal" });
    const team = await createProjectTool(ctx, { name: "Squad", format: "short_9x16", space: "seattle-solvers" });
    const alias = await createProjectTool(ctx, { name: "Alias", format: "short_9x16", space: "personal" });
    for (const r of [mine, team, alias]) expect(r.isError, r.text).toBe(false);
    const idOf = (text: string) => /\(id ([^)]+)\)/.exec(text)![1];

    const inPersonal = (await listProjects(db, testActor({ spaceId: personalSpaceId("u1") }))).map((p) => p.name).sort();
    const inTeam = (await listProjects(db, testActor())).map((p) => p.name);
    expect(inPersonal).toEqual(["Alias", "Solo"]);
    expect(inTeam).toEqual(["Squad"]);
    expect(mine.text).toContain(`/editor/${idOf(mine.text)}`);
    expect(await actorForProject(ctx, idOf(team.text))).toEqual({ userId: agentActorId("claude", "u1"), email: "u1@gmail.com", role: "editor", spaceId: SEED_TEAM_ID });
  });

  it("a retried create looks for its twin only in the space asked for", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const a = await createProjectTool(ctx, { name: "Same", format: "short_9x16", space: "personal" });
    const b = await createProjectTool(ctx, { name: "Same", format: "short_9x16", space: "seattle-solvers" });
    const again = await createProjectTool(ctx, { name: "Same", format: "short_9x16", space: "seattle-solvers" });
    expect(a.text).toMatch(/^Created/);
    expect(b.text).toMatch(/^Created/);
    expect(again.text).toMatch(/^This project was created a moment ago/);
  });

  it("create_project refuses a space the person isn't in", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    await otherTeam(db);
    for (const space of ["elsewhere", "team_elsewhere", 'no "such"\nspace']) {
      const result = await createProjectTool(ctx, { name: "Nope", format: "short_9x16", space });
      expect(result.isError).toBe(true);
      expect(result.text).toBe(`No space "${space.replace(/"/g, '\\"').replace("\n", " ")}". Your spaces: "Personal" (space: personal), "Seattle Solvers" (space: seattle-solvers).`);
    }
    expect(await listProjects(db, elsewhere)).toHaveLength(1);
  });

  it("actorInSpace is the agent in a space of the person, and null elsewhere", async () => {
    const ctx = await toolContext(await makeTestDb());
    expect(actorInSpace(ctx, SEED_TEAM_ID)?.userId).toBe(agentActorId("claude", "u1"));
    expect(actorInSpace(ctx, personalSpaceId("u1"))?.role).toBe("admin");
    expect(actorInSpace(ctx, ELSEWHERE)).toBeNull();
  });

  it("tools treat other spaces' ids as missing", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const { project, asset } = await otherTeam(db);
    await applyProjectOps(db, elsewhere, { projectId: project, baseVersion: 0, ops: [addText(0) as OpInput] });

    const get = await getProjectTool(ctx, { project_id: project });
    expect(get.isError).toBe(true);
    const gone = await getProjectTool(ctx, { project_id: "nope" });
    expect(get.text).toBe(gone.text.replace("nope", project));

    const edit = await editTimelineTool(ctx, { project_id: project, expected_version: 1, ops: [{ op: "remove_clip", clipId: "x" }] });
    expect(edit).toEqual({ isError: true, text: get.text });
    const text = await editTimelineTool(ctx, { project_id: project, expected_version: 1, ops: [{ op: "add_clip", trackId: "v1", clip: { type: "video", assetId: asset, start: 0, duration: 30, inPoint: 0 } }] });
    expect(text).toEqual({ isError: true, text: get.text });
    const undo = await undoChangeTool(ctx, { project_id: project, expected_version: 1, version: 1 });
    expect(undo).toEqual({ isError: true, text: get.text });
    const media = await addMediaTool(ctx, { project_id: project, expected_version: 1, items: [{ asset_id: asset }] });
    expect(media).toEqual({ isError: true, text: get.text });

    const fetched = await fetchTool(ctx, { id: `project:${project}` });
    expect(fetched).toEqual({ isError: true, text: get.text });
    expect((await fetchTool(ctx, { id: `asset:${asset}` })).isError).toBe(true);
    expect(await actorForProject(ctx, project)).toBeNull();

    // Nothing changed.
    expect((await getProject(db, elsewhere, project))!.version).toBe(1);
  });

  it("add_media refuses an asset from another space of the same person", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const personal = await insertAsset(db, { spaceId: personalSpaceId("u1"), name: "Home clip" });
    const { id } = await createProject(db, ctx.actor, { name: "Team cut", format: "short_9x16" });
    const result = await addMediaTool(ctx, { project_id: id, expected_version: 0, items: [{ asset_id: personal }] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('That media is in "Personal"; this project is in "Seattle Solvers".');
    const edit = await editTimelineTool(ctx, { project_id: id, expected_version: 0, ops: [{ op: "add_clip", trackId: "v1", clip: { type: "video", assetId: personal, start: 0, duration: 30, inPoint: 0 } }] });
    expect(edit.isError).toBe(true);
    expect(edit.text).toContain('That media is in "Personal"; this project is in "Seattle Solvers".');

    // The same asset is fine in a project of its own space.
    const home = await createProject(db, testActor({ userId: "u1", spaceId: personalSpaceId("u1") }), { name: "Home cut", format: "short_9x16" });
    const fine = await addMediaTool(ctx, { project_id: home.id, expected_version: 0, items: [{ asset_id: personal }] });
    expect(fine.isError, fine.text).toBe(false);
  });

  it("says which space media is in when it is in another space of the person, and keeps 'No asset' for spaces they are not in", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const { asset: foreign } = await otherTeam(db);
    const team = await insertAsset(db, { name: "Team clip" });
    const created = await createProjectTool(ctx, { name: "Home cut", format: "short_9x16", space: "personal" });
    const id = /\(id ([^)]+)\)/.exec(created.text)![1];
    expect(created.text.split("\n")[0]).toBe(`Created project "Home cut" (id ${id}) in space "Personal", version 0.`);

    const said = 'That media is in "Seattle Solvers"; this project is in "Personal". Media can only be used in projects of its own space.';
    const media = await addMediaTool(ctx, { project_id: id, expected_version: 0, items: [{ asset_id: team }] });
    expect(media).toEqual({ isError: true, text: `items[0]: ${said}\nNothing was applied.` });
    const clip = { type: "video", assetId: team, start: 0, duration: 30, inPoint: 0 };
    const edit = await editTimelineTool(ctx, { project_id: id, expected_version: 0, ops: [{ op: "add_clip", trackId: "v1", clip }] });
    expect(edit.text).toBe(`Edit refused: ops[0] (add_clip) names media that can't be used.\n${said}\nNothing was applied.`);

    const hidden = await addMediaTool(ctx, { project_id: id, expected_version: 0, items: [{ asset_id: foreign }] });
    expect(hidden.text).toBe(`items[0]: No asset with id "${foreign}". Call list_assets to see the ids.\nNothing was applied.`);
    expect(hidden.text).not.toContain("Elsewhere");
    const hiddenEdit = await editTimelineTool(ctx, { project_id: id, expected_version: 0, ops: [{ op: "add_clip", trackId: "v1", clip: { ...clip, assetId: foreign } }] });
    expect(hiddenEdit.text).toContain(`No asset with id "${foreign}". Call list_assets to see the ids.`);
    expect(hiddenEdit.text).not.toContain("Elsewhere");
  });
});
