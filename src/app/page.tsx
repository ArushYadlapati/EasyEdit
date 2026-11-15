import { redirect } from "next/navigation";
import { HomePage } from "@/components/home/home-page";
import { getCurrentUser } from "@/lib/access";
import { openSignUp } from "@/lib/signup";

// Public: the proxy lets a signed-out visitor through, so this page decides. Decided by the allowlist, not by cookie presence.
export default async function Home() {
  if (await getCurrentUser()) redirect("/dashboard");
  return <HomePage closedBeta={!openSignUp()} />;
}
