import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SITE_METADATA, SITE_VIEWPORT, SitePage } from "@/components/site/site-page";
import { LEGAL_ARTICLE, LEGAL_H2, LEGAL_MAIN, LEGAL_TITLE } from "@/app/legal";

export const metadata: Metadata = { ...SITE_METADATA, title: "Terms · EasyEdit" };
export const viewport: Viewport = SITE_VIEWPORT;

const LIST = "flex list-disc flex-col gap-2 pl-5";

export default function TermsPage() {
  return (
    <SitePage current="terms">
      <main className={LEGAL_MAIN}>
        <article className={LEGAL_ARTICLE}>
          <h1 className={LEGAL_TITLE}>Terms of service</h1>
          <p className="text-sm text-(--h-muted)">Last updated November 17, 2026.</p>
          <p>These are the rules for using EasyEdit. By signing in, you agree to them. If you don&apos;t agree, don&apos;t use EasyEdit.</p>

          <h2 className={LEGAL_H2}>Who can use EasyEdit</h2>
          <p>
            You must be at least 13 years old. If you are under 18, a parent or guardian should know that you use EasyEdit. You sign in with a
            Google account.
          </p>

          <h2 className={LEGAL_H2}>Your account</h2>
          <p>
            Keep your Google account and any passkeys safe. You are responsible for what happens with your account, including what an AI agent
            you connect does with it.
          </p>

          <h2 className={LEGAL_H2}>What you make</h2>
          <p>
            You keep ownership of your projects and the media you upload. You let EasyEdit store, process and show them only so it can work for
            you and for the people in your space. Your media is kept in the Google Drive your space uses, so Google&apos;s own terms apply to it
            too.
          </p>

          <h2 className={LEGAL_H2}>Posting to YouTube</h2>
          <p>
            EasyEdit can post a video to a YouTube channel that a space&apos;s admin connected. It uses YouTube API Services to do that, so by
            posting from EasyEdit you also agree to the{" "}
            <a className="underline underline-offset-4" href="https://www.youtube.com/t/terms">
              YouTube Terms of Service
            </a>
            . You are responsible for what you post.
          </p>

          <h2 className={LEGAL_H2}>Teams</h2>
          <p>
            In a team, other members can see and change the team&apos;s projects, depending on their role. A team&apos;s admins can add and
            remove members and change their roles. Projects made in a team belong to the team and stay there if you leave.
          </p>

          <h2 className={LEGAL_H2}>What you may not do</h2>
          <ul className={LIST}>
            <li>Upload media you don&apos;t have the right to use, such as someone else&apos;s music or video without permission.</li>
            <li>Upload anything illegal, or use EasyEdit to harass or threaten anyone.</li>
            <li>Try to get into spaces or accounts that aren&apos;t yours, or to break, overload or get around EasyEdit&apos;s security.</li>
            <li>Have an AI agent do any of these things for you.</li>
          </ul>

          <h2 className={LEGAL_H2}>Removing content and accounts</h2>
          <p>
            The owner of this EasyEdit site can remove content or end someone&apos;s access if these rules are broken, or if EasyEdit has to
            stop running. You can leave a team or stop using EasyEdit at any time.
          </p>

          <h2 className={LEGAL_H2}>No guarantees</h2>
          <p>
            EasyEdit is free and provided as is. It may change, stop working for a while, or lose data, and it may shut down. Keep your own
            copies of anything important: export finished videos and keep your original media.
          </p>
          <p>
            As far as the law allows, the owner of this EasyEdit site is not responsible for losses that come from using EasyEdit, including lost
            projects or media.
          </p>

          <h2 className={LEGAL_H2}>Changes to these terms</h2>
          <p>
            These terms may change. When they do, the date at the top changes. If you keep using EasyEdit after that, you agree to the new terms.
          </p>

          <h2 className={LEGAL_H2}>Privacy and contact</h2>
          <p>
            What EasyEdit collects and where it is kept is on the{" "}
            <Link href="/privacy" className="underline underline-offset-4">
              privacy page
            </Link>
            . For questions about these terms, email{" "}
            <a className="underline underline-offset-4" href="mailto:help@arush.dev">
              help@arush.dev
            </a>
            .
          </p>
        </article>
      </main>
    </SitePage>
  );
}
