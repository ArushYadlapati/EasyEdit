// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { SpaceSwitcher } from "@/components/dashboard/space-switcher";
import type { MySpace } from "@/lib/spaces/types";
import { fireEvent, render, screen, waitFor } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, unstable_rethrow: () => {} }));

const PERSONAL: MySpace = { id: "personal_u1", slug: "personal_u1", name: "Ada's space", kind: "personal", role: "admin" };
const TEAM: MySpace = { id: "team_seattle_solvers", slug: "seattle-solvers", name: "Seattle Solvers", kind: "team", role: "admin" };

describe("Create a team", () => {
  it("is hidden without the action (sign-up closed, not an admin)", () => {
    render(<SpaceSwitcher spaces={[PERSONAL, TEAM]} current={PERSONAL.id} />);
    expect(screen.queryByText("Create a team")).toBeNull();
  });

  it("is the last item of the list", () => {
    render(<SpaceSwitcher spaces={[PERSONAL, TEAM]} current={PERSONAL.id} createTeam={async () => ({})} />);
    const nav = screen.getByRole("navigation", { name: "My Spaces" });
    const items = [...nav.querySelectorAll("a, button")].filter((e) => !e.closest("dialog"));
    expect(items.at(-1)?.textContent).toBe("Create a team");
  });

  it("asks for a name, creates, and goes to the team's storage settings", async () => {
    const createTeam = vi.fn(async (formData: FormData) => ({ slug: `slug-of-${formData.get("name")}` }));
    render(<SpaceSwitcher spaces={[PERSONAL]} current={PERSONAL.id} createTeam={createTeam} />);
    fireEvent.click(screen.getByRole("button", { name: "Create a team" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Team name" }), { target: { value: "Robots" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/s/slug-of-Robots/settings/storage?first=1"));
    expect(createTeam).toHaveBeenCalledTimes(1);
  });

  it("shows a refusal in the dialog and stays", async () => {
    router.push.mockClear();
    const createTeam = vi.fn(async () => ({ error: "You've made 10 teams today. Try again tomorrow." }));
    render(<SpaceSwitcher spaces={[PERSONAL]} current={PERSONAL.id} createTeam={createTeam} />);
    fireEvent.click(screen.getByRole("button", { name: "Create a team" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Team name" }), { target: { value: "Robots" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByRole("alert")).textContent).toBe("You've made 10 teams today. Try again tomorrow.");
    expect(router.push).not.toHaveBeenCalled();
  });
});
