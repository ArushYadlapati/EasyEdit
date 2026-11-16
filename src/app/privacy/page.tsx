import Link from "next/link";

export const metadata = { title: "Privacy - EasyEdit" };

const H2 = "text-lg font-semibold tracking-tight";

export default function PrivacyPage() {
  return (
    <main className="flex flex-1 justify-center px-6 py-16">
      <article className="flex w-full max-w-2xl flex-col gap-5 leading-relaxed">
        <Link href="/" className="text-sm text-foreground/70 underline underline-offset-4">
          EasyEdit
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>

        <h2 className={H2}>What we collect</h2>
        <p>
          When you sign in with Google, EasyEdit gets your name, email address and profile picture. It also keeps what you make: your projects
          and the media you upload. That media is stored in the Google Drive the space uses, not on EasyEdit&apos;s own servers: a Google
          account someone in the space connected. For Seattle Solvers, that is the team&apos;s shared drive.
        </p>

        <h2 className={H2}>What EasyEdit can see in your Google Drive</h2>
        <p>
          EasyEdit asks Google for one permission, <code>drive.file</code>. It lets EasyEdit see only the files and folders that EasyEdit itself
          creates in your Drive. It cannot see anything else in your Drive.
        </p>

        <h2 className={H2}>Where your data lives</h2>
        <p>
          Accounts and projects are kept in a Neon database. The website runs on Vercel. Your media is kept in Google Drive. These companies
          process the data for us.
        </p>

        <h2 className={H2}>AI agents</h2>
        <p>An AI agent can work on your projects only after you connect it to your account. It acts with your connection, and you can disconnect it.</p>

        <h2 className={H2}>Deleting your data</h2>
        <p>
          To have your data deleted, email{" "}
          <a className="underline underline-offset-4" href="mailto:privacy@arush.dev">
            privacy@arush.dev
          </a>
          .
        </p>

        <h2 className={H2}>Rules for using EasyEdit</h2>
        <p>
          The rules are in the{" "}
          <Link href="/terms" className="underline underline-offset-4">
            terms of service
          </Link>
          .
        </p>

        <h2 className={H2}>Contact</h2>
        <p>
          Questions about privacy:{" "}
          <a className="underline underline-offset-4" href="mailto:privacy@arush.dev">
            privacy@arush.dev
          </a>
        </p>
      </article>
    </main>
  );
}
