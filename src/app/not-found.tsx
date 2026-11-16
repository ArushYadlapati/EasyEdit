import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/ui/logo";

// Every 404 lands here: an address that matches no route, and any page that calls notFound() (a project or space that
// doesn't exist, or that this person can't see). Without this file Next shows its own bare page, in a system font and
// pure black or white, with none of EasyEdit's look. Laid out like the login page; "/" sends a signed-in person on to
// the dashboard and shows everyone else the home page.
export const metadata: Metadata = { title: "Page not found · EasyEdit" };

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <LogoMark size={56} />
        <div className="flex flex-col gap-2">
          <p className="font-mono text-sm text-foreground/60">404</p>
          <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          <p className="text-balance text-foreground/70">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        </div>
        <Link
          href="/"
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-foreground px-5 font-medium text-background transition-opacity hover:opacity-85"
        >
          Go to EasyEdit
        </Link>
      </div>
    </main>
  );
}
