import { redirect } from "next/navigation";
import { settingsTabPath, SETTINGS_TABS } from "@/components/dashboard/settings-tabs";

// /s/<space>/settings opens its first tab. The tab's page checks who may see it.
export default async function SpaceSettingsIndex({ params }: PageProps<"/s/[space]/settings">): Promise<never> {
  redirect(settingsTabPath((await params).space, SETTINGS_TABS[0]!.id));
}
