import { describe, expect, it } from "vitest";
import { actorUserId, agentActorId, displayActor } from "@/lib/projects/display-actor";

const names = new Map([["u1", "Ada Lovelace"]]);

describe("displayActor", () => {
  it("shows a known user's name", () => {
    expect(displayActor("u1", names)).toBe("Ada Lovelace");
  });

  it("shows Claude acting for a known user", () => {
    expect(displayActor("claude:u1", names)).toBe("Claude (for Ada Lovelace)");
  });

  it("shows Someone for an unknown user", () => {
    expect(displayActor("u9", names)).toBe("Someone");
  });

  it("shows Claude for a claude actor whose user is unknown", () => {
    expect(displayActor("claude:u9", names)).toBe("Claude");
  });

  it("shows any other AI agent by its own name", () => {
    expect(displayActor(agentActorId("cursor", "u1"), names)).toBe("Cursor (for Ada Lovelace)");
    expect(displayActor("agent:vscode:u1", names)).toBe("VS Code (Copilot) (for Ada Lovelace)");
    expect(displayActor("agent:chatgpt:u9", names)).toBe("ChatGPT");
    expect(displayActor("agent:other:u1", names)).toBe("AI agent (for Ada Lovelace)");
    expect(displayActor("agent:not-a-kind:u1", names)).toBe("AI agent (for Ada Lovelace)");
  });
});

describe("actorUserId", () => {
  it("returns the user id behind an actor", () => {
    expect(actorUserId("u1")).toBe("u1");
    expect(actorUserId("claude:u1")).toBe("u1");
    expect(actorUserId("agent:claude-code:u1")).toBe("u1");
    expect(actorUserId("agent:not-a-kind:u1")).toBe("u1");
  });
});
