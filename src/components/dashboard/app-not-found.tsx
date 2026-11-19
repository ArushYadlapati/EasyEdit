import Link from "next/link";
import type { ReactNode } from "react";
import { linkButtonClass } from "@/components/ui/button-class";

// A page that isn't there, for someone signed in: a project or space that doesn't exist or that this person can't see,
// or a page this server doesn't offer (Learn without the tutorial's video). It is drawn in the app's own colours, and
// the way out is the person's projects rather than the public site's sign-in. The dashboard shows it under its header
// (app/(dashboard)/not-found.tsx); the editor, which has no header, on its own (app/(editor)/not-found.tsx).
export function AppNotFound(): ReactNode {
  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-md flex-col items-start gap-3 px-4 py-16">
        <h1 className="text-base font-semibold">Page not found</h1>
        <p className="text-[13px] leading-5 text-ed-muted">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Link href="/dashboard" className={linkButtonClass("primary", "mt-1")}>
          Go to your projects
        </Link>
      </div>
    </main>
  );
}
