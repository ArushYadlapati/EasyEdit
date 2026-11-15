import { redirect } from "next/navigation";
import { HomePage } from "@/components/home/home-page";
import { getCurrentUser } from "@/lib/access";

// Public: the proxy lets a signed-out visitor through, so this page decides. Decided by the allowlist, not by cookie presence.
export default async function Home() {
  if (await getCurrentUser()) redirect("/dashboard");
  return <HomePage />;
}
