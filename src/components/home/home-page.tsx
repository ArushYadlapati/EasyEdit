import Link from "next/link";
import { LogoMark } from "@/components/ui/logo";

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
        <LogoMark size={56} />
        <h1 className="text-2xl font-semibold tracking-tight">EasyEdit</h1>
        <p>Edit short videos with your team, and with AI agents.</p>
        {closedBeta && <p className="text-sm text-foreground/70">Sign-in is by invitation only for now.</p>}
        <Link
          href="/login"
          className="flex h-11 w-full items-center justify-center rounded-full bg-foreground px-5 font-medium text-background"
        >
          Sign in
        </Link>
        <Link href="/privacy" className="text-sm text-foreground/70 underline underline-offset-4">
          Privacy
        </Link>
      </div>
    </main>
  );
}
