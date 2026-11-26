import { skillArchive } from "@/lib/skills";
import { SKILL_ZIP_NAME } from "@/lib/skills/words";

// The zip is the same bytes for the same files, so it is made once, at build time.
export const dynamic = "force-static";

// The video skill as a zip, for anyone: easyedit-video/SKILL.md and easyedit-video/references/*.md, ready to unzip into
// an agent's skills folder or upload to Claude. Public, like the skill's files in the repo, so there's no sign-in.
export function GET(): Response {
  return new Response(skillArchive(), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${SKILL_ZIP_NAME}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
