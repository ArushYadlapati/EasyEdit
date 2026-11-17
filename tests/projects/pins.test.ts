import { describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { projectPins } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import { listPinnedIds, pinProject, unpinProject } from "@/lib/projects/pins";
import { createProject, deleteProject } from "@/lib/projects/service";
import { ServiceError } from "@/lib/service-error";
import { personalSpaceId } from "@/lib/spaces/types";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

// PGlite's clock has millisecond resolution; wait so consecutive pins get distinct timestamps.
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 5));

// u1 edits the team and has a personal space; u2 edits the team; u3 views it.
async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "u1" }, "editor");
  await joinSpace(db, { id: "u1" }, "admin", personalSpaceId("u1"));
  await joinSpace(db, { id: "u2" }, "editor");
  await joinSpace(db, { id: "u3" }, "viewer");
  const u1 = testActor({ userId: "u1", role: "editor" });
  const u1Personal = testActor({ userId: "u1", role: "admin", spaceId: personalSpaceId("u1") });
  const u2 = testActor({ userId: "u2", email: "u2@gmail.com", role: "editor" });
  const u3 = testActor({ userId: "u3", email: "u3@gmail.com", role: "viewer" });
  return { db, u1, u1Personal, u2, u3 };
}

const newProject = async (db: DB, actor: Actor, name: string) => (await createProject(db, actor, { name, format: "short_9x16" })).id;

describe("pins", () => {
  it("the space's pins, oldest first, are the same for everyone in it", async () => {
    const { db, u1, u2, u3 } = await setup();
    const a = await newProject(db, u1, "A");
    const b = await newProject(db, u1, "B");
    await pinProject(db, u1, b);
    await nextMillisecond();
    await pinProject(db, u2, a);
    expect(await listPinnedIds(db, u1)).toEqual([b, a]);
    expect(await listPinnedIds(db, u2)).toEqual([b, a]);
    expect(await listPinnedIds(db, u3)).toEqual([b, a]);
  });

  it("pinning twice keeps one pin in its place; unpinning twice is fine", async () => {
    const { db, u1, u2 } = await setup();
    const a = await newProject(db, u1, "A");
    const b = await newProject(db, u1, "B");
    await pinProject(db, u1, a);
    await nextMillisecond();
    await pinProject(db, u1, b);
    await nextMillisecond();
    await pinProject(db, u2, a);
    expect(await listPinnedIds(db, u1)).toEqual([a, b]);
    await unpinProject(db, u2, a);
    await unpinProject(db, u1, a);
    expect(await listPinnedIds(db, u1)).toEqual([b]);
  });

  it("a viewer can't pin or unpin", async () => {
    const { db, u1, u3 } = await setup();
    const a = await newProject(db, u1, "A");
    await expect(pinProject(db, u3, a)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await pinProject(db, u1, a);
    await expect(unpinProject(db, u3, a)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listPinnedIds(db, u1)).toEqual([a]);
  });

  it("a deleted project leaves the list, and can't be pinned", async () => {
    const { db, u1 } = await setup();
    const a = await newProject(db, u1, "A");
    const b = await newProject(db, u1, "B");
    await pinProject(db, u1, a);
    await pinProject(db, u1, b);
    await deleteProject(db, u1, a);
    expect(await listPinnedIds(db, u1)).toEqual([b]);
    await expect(pinProject(db, u1, a)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(unpinProject(db, u1, a)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deleting a project removes its pin row in the same write; a refused delete leaves pins alone", async () => {
    const { db, u1, u1Personal } = await setup();
    const a = await newProject(db, u1, "A");
    const b = await newProject(db, u1, "B");
    await pinProject(db, u1, a);
    await pinProject(db, u1, b);
    await deleteProject(db, u1, a);
    const pinned = async () => (await db.select({ id: projectPins.projectId }).from(projectPins)).map((row) => row.id);
    expect(await pinned()).toEqual([b]);
    await expect(deleteProject(db, u1Personal, b)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteProject(db, u1, a)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await pinned()).toEqual([b]);
  });

  it("pins stay in their space: another space's project is not found there, and its pins aren't listed", async () => {
    const { db, u1, u1Personal } = await setup();
    const team = await newProject(db, u1, "Team");
    const mine = await newProject(db, u1Personal, "Mine");
    await pinProject(db, u1Personal, mine);
    await expect(pinProject(db, u1Personal, team)).rejects.toBeInstanceOf(ServiceError);
    await expect(pinProject(db, u1Personal, team)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(unpinProject(db, u1, mine)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listPinnedIds(db, u1)).toEqual([]);
    expect(await listPinnedIds(db, u1Personal)).toEqual([mine]);
  });

  it("an unknown project is not found", async () => {
    const { db, u1 } = await setup();
    await expect(pinProject(db, u1, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
