import Link from "next/link";

export function HomePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">EasyEdit</h1>
        <p>Edit short videos with your team, and with AI agents.</p>
        <Link
          href="/login"
          className="flex h-11 w-full items-center justify-center rounded-full bg-foreground px-5 font-medium text-background"
        >
          Continue with Google
        </Link>
        <Link href="/privacy" className="text-sm text-foreground/70 underline underline-offset-4">
          Privacy
        </Link>
      </div>
    </main>
  );
}
