import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SITE_METADATA, SITE_VIEWPORT, SitePage } from "@/components/site/site-page";
import { LEGAL_ARTICLE, LEGAL_MAIN, LEGAL_TITLE } from "@/app/legal";
import { LegalContents, LegalH2 } from "@/app/legal-contents";

export const metadata: Metadata = { ...SITE_METADATA, title: "Terms · EasyEdit" };
export const viewport: Viewport = SITE_VIEWPORT;

const LIST = "flex list-disc flex-col gap-2 pl-5";

// The page's section headings, in order, for the list beside the text (a test checks they match the headings).
const SECTIONS = [
  "Who can use EasyEdit",
  "Your account",
  "What you make",
  "Posting to YouTube",
  "Teams",
  "What you may not do",
  "Removing content and accounts",
  "No guarantees",
  "Changes to these terms",
  "Privacy and contact",
];

export default function TermsPage() {
  return (
    <SitePage current="terms">
      <main className={LEGAL_MAIN}>
        <LegalContents sections={SECTIONS} />
        <article className={LEGAL_ARTICLE}>
          <h1 className={LEGAL_TITLE}>Terms of service</h1>
          <p className="text-sm text-(--h-muted)">Last updated November 17, 2026.</p>
          <p>These are the rules for using EasyEdit. By signing in, you agree to them. If you don&apos;t agree, don&apos;t use EasyEdit.</p>

          <LegalH2>Who can use EasyEdit</LegalH2>
          <p>
            You must be at least 13 years old. If you are under 18, a parent or guardian should know that you use EasyEdit. You sign in with a
            Google account.
          </p>

          <LegalH2>Your account</LegalH2>
          <p>
            Keep your Google account and any passkeys safe. You are responsible for what happens with your account, including what an AI agent
            you connect does with it.
          </p>

          <LegalH2>What you make</LegalH2>
          <p>
            You keep ownership of your projects and the media you upload. You let EasyEdit store, process and show them only so it can work for
            you and for the people in your space. Your media is kept in the Google Drive your space uses, so Google&apos;s own terms apply to it
            too.
          </p>

          <LegalH2>Posting to YouTube</LegalH2>
          <p>
            EasyEdit can post a video to a YouTube channel that a space&apos;s admin connected. It uses YouTube API Services to do that, so by
            posting from EasyEdit you also agree to the{" "}
            <a className="underline underline-offset-4" href="https://www.youtube.com/t/terms">
              YouTube Terms of Service
            </a>
            . You are responsible for what you post.
          </p>

          <LegalH2>Teams</LegalH2>
          <p>
            In a team, other members can see and change the team&apos;s projects, depending on their role. A team&apos;s admins can add and
            remove members and change their roles. Projects made in a team belong to the team and stay there if you leave.
          </p>

          <LegalH2>What you may not do</LegalH2>
          <ul className={LIST}>
            <li>Upload media you don&apos;t have the right to use, such as someone else&apos;s music or video without permission.</li>
            <li>Upload anything illegal, or use EasyEdit to harass or threaten anyone.</li>
            <li>Try to get into spaces or accounts that aren&apos;t yours, or to break, overload or get around EasyEdit&apos;s security.</li>
            <li>Have an AI agent do any of these things for you.</li>
          </ul>

          <LegalH2>Removing content and accounts</LegalH2>
          <p>
            The owner of this EasyEdit site can remove content or end someone&apos;s access if these rules are broken, or if EasyEdit has to
            stop running. You can leave a team or stop using EasyEdit at any time.
          </p>

          <LegalH2>No guarantees</LegalH2>
          <p>
            EasyEdit is free and provided as is. It may change, stop working for a while, or lose data, and it may shut down. Keep your own
            copies of anything important: export finished videos and keep your original media.
          </p>
          <p>
            As far as the law allows, the owner of this EasyEdit site is not responsible for losses that come from using EasyEdit, including lost
            projects or media.
          </p>

          <LegalH2>Changes to these terms</LegalH2>
          <p>
            These terms may change. When they do, the date at the top changes. If you keep using EasyEdit after that, you agree to the new terms.
          </p>

          <LegalH2>Privacy and contact</LegalH2>
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
