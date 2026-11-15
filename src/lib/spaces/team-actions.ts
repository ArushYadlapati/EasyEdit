import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { ServiceError } from "@/lib/service-error";
import { createTeam } from "./service";

export type TeamFormState = { error?: string; slug?: string };

export type TeamActionDeps = {
  db: () => DB;
  requireUser: () => Promise<CurrentUser>;
  revalidate: (path: string) => void;
  canCreateTeam: (user: CurrentUser) => Promise<boolean>; // sign-up is open, or the person runs Seattle Solvers
};

export function makeTeamActions(deps: TeamActionDeps) {
  return {
    async create(formData: FormData): Promise<TeamFormState> {
      const user = await deps.requireUser();
      if (!(await deps.canCreateTeam(user))) return { error: "Creating teams isn't open yet." };
      const name = formData.get("name");
      try {
        const space = await createTeam(deps.db(), { name: typeof name === "string" ? name : "", byUserId: user.id });
        deps.revalidate("/");
        return { slug: space.slug };
      } catch (error) {
        if (error instanceof ServiceError) return { error: error.message };
        throw error;
      }
    },
  };
}
