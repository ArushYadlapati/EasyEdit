import { AppNotFound } from "@/components/dashboard/app-not-found";

// A project the editor can't open (it doesn't exist, or this person can't see it). The (editor) group has no layout,
// so this draws the app's dark ground itself, as the editor does.
export default function EditorNotFound() {
  return (
    <div className="ed-theme flex h-dvh flex-col bg-ed-bg font-sans text-ed-text">
      <AppNotFound />
    </div>
  );
}
