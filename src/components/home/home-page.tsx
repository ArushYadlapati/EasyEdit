import Link from "next/link";

// closedBeta: sign-up isn't open yet (openSignUp() in signup.ts, read on the server), so only invited people get in.
export function HomePage({ closedBeta }: { closedBeta: boolean }) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        {closedBeta && (
          <span className="rounded-full border border-foreground/20 px-3 py-1 text-xs font-medium tracking-wide text-foreground/70 uppercase">
            Closed beta
          </span>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">EasyEdit</h1>
        <p>Edit short videos with your team, and with AI agents.</p>
        {closedBeta && <p className="text-sm text-foreground/70">Sign-in is by invitation only for now.</p>}
        <Link
          href="/login"
          className="flex h-11 w-full items-center justify-center rounded-full bg-foreground px-5 font-medium text-background"
        >
          Sign in
        </Link>
        <nav className="flex gap-4 text-sm text-foreground/70">
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy
          </Link>
          <Link href="/terms" className="underline underline-offset-4">
            Terms
          </Link>
        </nav>
      </div>
    </main>
  );
}
