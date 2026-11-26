import { slugFor } from "@/lib/spaces/paths";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { settingsTabPath } from "@/lib/spaces/settings-tabs";
import { PERSONAL_ALIAS, type MySpace } from "@/lib/spaces/types";
import { actorInSpace } from "./actors";
import { noSuchSpace, personalSoon, teamList } from "./tools/create-project";
import type { SpaceToolContext, ToolContext } from "./types";

// The settings tab a space's style is kept on.
const STYLE_TAB = "style";

// While personal spaces are not offered, a style is kept in a team, like a project.
export function styleSoon(ctx: ToolContext): string {
  const teams = teamList(ctx);
  return teams ? `Personal spaces are coming soon, so a style is kept in a team for now. Your teams: ${teams}.` : personalSoon(ctx);
}

// The space get_editing_guide or save_style names: a slug as list_projects shows it, or "personal" for the person's
// own, with any spaces around it ignored. A space the person is not in answers exactly like one that doesn't exist.
// While personal spaces are not offered, the personal space is refused, by its alias or its own slug, as
// create_project refuses it.
export function styleSpace(ctx: ToolContext, given: string): { space: MySpace; ctx: SpaceToolContext } | { error: string } {
  const slug = given.trim();
  const space = slug === PERSONAL_ALIAS ? ctx.spaces.find((s) => s.kind === "personal") : ctx.spaces.find((s) => s.slug === slug);
  if (!space) return { error: noSuchSpace(ctx, slug) };
  if (space.kind === "personal" && !personalSpacesOpen()) return { error: styleSoon(ctx) };
  const actor = actorInSpace(ctx, space.id);
  if (!actor) return { error: noSuchSpace(ctx, slug) };
  return { space, ctx: { ...ctx, actor } };
}

// The address of a space's Style page, where people see and change its style.
export function stylePageUrl(ctx: ToolContext, space: MySpace): string {
  return `${ctx.baseUrl}${settingsTabPath(slugFor(space), STYLE_TAB)}`;
}
