import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { EDIT_DESCRIPTION, SERVER_INSTRUCTIONS, buildEditingGuide } from "@/lib/mcp/guide";
import { SKILL_MD, SKILL_TOPICS, TOPIC_IDS } from "@/lib/skills";
import { startConnectorApp, type ConnectorApp } from "../helpers/connector";

let testDb: DB;
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: () => testDb }));

let app: ConnectorApp;
beforeAll(async () => {
  app = await startConnectorApp();
  testDb = app.db;
});
afterAll(() => app.stop());

describe("the guide, through the endpoint", () => {
  it("reaches Claude as instructions, a tool, a prompt and a resource, all with the same text", async () => {
    const c = await app.connect("ada@gmail.com", "viewer");
    const client = await app.mcpClient(c.accessToken);
    try {
      expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);

      const tools = (await client.listTools()).tools;
      expect(tools.find((t) => t.name === "edit_timeline")?.description).toBe(EDIT_DESCRIPTION);
      const viaTool = await client.callTool({ name: "get_editing_guide", arguments: {} });
      expect(viaTool.content).toEqual([{ type: "text", text: buildEditingGuide() }]);

      expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(["editing-guide", ...TOPIC_IDS, "learn-my-style", "edit-in-my-style"]);
      const viaPrompt = await client.getPrompt({ name: "editing-guide" });
      expect(viaPrompt.messages).toEqual([{ role: "user", content: { type: "text", text: buildEditingGuide() } }]);

      expect((await client.listResources()).resources.map((r) => r.uri)).toEqual([
        "easyedit://editing-guide",
        "easyedit://skills",
        ...TOPIC_IDS.map((id) => `easyedit://skills/${id}`),
      ]);
      const viaResource = await client.readResource({ uri: "easyedit://editing-guide" });
      expect(viaResource.contents).toEqual([expect.objectContaining({ uri: "easyedit://editing-guide", text: buildEditingGuide() })]);
    } finally {
      await client.close();
    }
  });

  it("serves every skill topic as a tool answer, a prompt and a resource, all with the topic's own file", async () => {
    const c = await app.connect("ada@gmail.com", "viewer");
    const client = await app.mcpClient(c.accessToken);
    try {
      const prompts = (await client.listPrompts()).prompts;
      const resources = (await client.listResources()).resources;
      for (const topic of SKILL_TOPICS) {
        const viaTool = await client.callTool({ name: "get_editing_guide", arguments: { topic: topic.id } });
        expect(viaTool.isError, topic.id).toBeFalsy();
        expect(viaTool.content, topic.id).toEqual([{ type: "text", text: topic.body }]);

        expect(prompts.find((p) => p.name === topic.id), topic.id).toMatchObject({ title: topic.title, description: topic.summary });
        const viaPrompt = await client.getPrompt({ name: topic.id });
        expect(viaPrompt.messages, topic.id).toEqual([{ role: "user", content: { type: "text", text: topic.body } }]);

        const uri = `easyedit://skills/${topic.id}`;
        expect(resources.find((r) => r.uri === uri), topic.id).toMatchObject({ title: topic.title, mimeType: "text/markdown" });
        const viaResource = await client.readResource({ uri });
        expect(viaResource.contents, topic.id).toEqual([{ uri, mimeType: "text/markdown", text: topic.body }]);
      }

      const skill = await client.readResource({ uri: "easyedit://skills" });
      expect(skill.contents).toEqual([{ uri: "easyedit://skills", mimeType: "text/markdown", text: SKILL_MD }]);
      expect(resources.find((r) => r.uri === "easyedit://skills")).toMatchObject({ title: "Video skills", mimeType: "text/markdown" });
    } finally {
      await client.close();
    }
  });

  it("answers an unknown topic with the topics there are", async () => {
    const c = await app.connect("ada@gmail.com", "viewer");
    const client = await app.mcpClient(c.accessToken);
    try {
      const result = await client.callTool({ name: "get_editing_guide", arguments: { topic: "lighting" } });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: `No topic "lighting". Topics: ${TOPIC_IDS.join(", ")}, and style (with a space).` }]);
    } finally {
      await client.close();
    }
  });
});
