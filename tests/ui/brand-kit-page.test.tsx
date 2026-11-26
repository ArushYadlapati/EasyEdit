// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { BrandKitPage } from "@/components/dashboard/brand-kit-page";
import { Sidebar } from "@/components/dashboard/sidebar";
import { SpacesProvider } from "@/components/dashboard/space-switcher";
import { DEFAULT_BRAND_KIT, type BrandKit } from "@/lib/brand/types";
import { settingsTabsFor } from "@/lib/spaces/settings-tabs";
import { personalSpaceId, SEED_TEAM_ID, type MySpace } from "@/lib/spaces/types";
import { act, fireEvent, render, screen, within } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

const photo = assetView({ id: "l2", kind: "image", name: "Field photo", durationMs: null, previewStatus: "none", previewFileId: null, posterFileId: null });
const KIT: BrandKit = { ...DEFAULT_BRAND_KIT, fonts: { title: "Orbitron", subtitle: "Geist", body: "Inter" } };

function page(canEdit: boolean) {
  const save = vi.fn(async (_space: string, patch: object) => ({ ...KIT, ...patch }) as BrandKit);
  render(<BrandKitPage spaceId={SEED_TEAM_ID} canEdit={canEdit} initial={KIT} storageReady services={pretendMediaServices([photo])} api={{ fetch: vi.fn(), save }} />);
  return save;
}

it("the settings tabs add Brand kit and Style for every member", () => {
  const tabs = (kind: "team" | "personal", role: MySpace["role"]) => settingsTabsFor({ kind, role }).map((t) => t.id);
  expect(tabs("team", "viewer")).toEqual(["members", "brand", "style", "templates"]);
  expect(tabs("team", "admin")).toEqual(["members", "storage", "brand", "style", "templates"]);
  expect(tabs("personal", "admin")).toEqual(["storage", "brand", "style", "templates"]);
});

it("an editor changes the title font", async () => {
  const save = page(true);
  await act(async () => fireEvent.change(screen.getByLabelText("Title font"), { target: { value: "Bebas Neue" } }));
  expect(save).toHaveBeenCalledWith(SEED_TEAM_ID, { titleFont: "Bebas Neue" });
});

it("a viewer sees the kit read-only", () => {
  page(false);
  expect(screen.getByText("Orbitron")).toBeTruthy();
  expect(screen.queryByLabelText("Title font")).toBeNull();
  expect(screen.getByText(/Only editors can change/)).toBeTruthy();
});

it("Add logo lists the space's images", async () => {
  const save = page(true);
  fireEvent.click(screen.getByRole("button", { name: "Add logo" }));
  await act(async () => fireEvent.click(within(screen.getByRole("dialog", { name: "Add a logo" })).getByRole("button", { name: "Use Field photo" })));
  expect(save).toHaveBeenCalledWith(SEED_TEAM_ID, { logoAssetIds: ["l2"] });
});

const team = (role: MySpace["role"]): MySpace => ({ id: "team_robots", slug: "robots", name: "Robots", kind: "team", role });
const sidebarIn = (spaces: MySpace[], spaceSlug: string, personalSoon = false) =>
  render(
    <SpacesProvider spaces={spaces} personalSoon={personalSoon}>
      <Sidebar folders={[]} view={{ kind: "recent" }} canEdit={false} spaceSlug={spaceSlug} onNewFolder={() => {}} onDropProject={() => {}} />
    </SpacesProvider>,
  );

it("a Brand kit link sits under the spaces", () => {
  sidebarIn([team("viewer")], "robots");
  const link = screen.getByRole("link", { name: "Brand kit" });
  expect(link.getAttribute("href")).toBe("/s/robots/settings/brand");
  const projects = screen.getByRole("heading", { name: "Projects" });
  expect(link.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const spaces = screen.getByRole("link", { name: /Robots/ });
  expect(spaces.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("a Style link sits right under Brand kit", () => {
  sidebarIn([team("viewer")], "robots");
  const brand = screen.getByRole("link", { name: "Brand kit" });
  const style = screen.getByRole("link", { name: "Style" });
  expect(style.getAttribute("href")).toBe("/s/robots/settings/style");
  const links = screen.getAllByRole("link");
  expect(links.indexOf(style)).toBe(links.indexOf(brand) + 1);
});

it("no Brand kit or Style link in a personal space while personal spaces are closed", () => {
  const personal: MySpace = { id: personalSpaceId("u1"), slug: personalSpaceId("u1"), name: "Personal", kind: "personal", role: "admin" };
  sidebarIn([personal, team("admin")], "personal", true);
  expect(screen.queryByRole("link", { name: "Brand kit" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Style" })).toBeNull();
});

it("a later save that works clears the error line of one that failed", async () => {
  const save = vi
    .fn(async (_space: string, patch: object) => ({ ...KIT, ...patch }) as BrandKit)
    .mockRejectedValueOnce(new Error("The brand kit could not be saved."));
  render(<BrandKitPage spaceId={SEED_TEAM_ID} canEdit initial={KIT} storageReady services={pretendMediaServices([photo])} api={{ fetch: vi.fn(), save }} />);
  await act(async () => fireEvent.change(screen.getByLabelText("Title font"), { target: { value: "Bebas Neue" } }));
  expect(screen.getByRole("alert").textContent).toBe("The brand kit could not be saved.");
  await act(async () => fireEvent.change(screen.getByLabelText("Body text font"), { target: { value: "Geist" } }));
  expect(save).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});
