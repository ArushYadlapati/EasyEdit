import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SITE_METADATA, SITE_VIEWPORT, SitePage } from "@/components/site/site-page";
import { LEGAL_ARTICLE, LEGAL_H2, LEGAL_MAIN, LEGAL_TITLE } from "@/app/legal";

export const metadata: Metadata = { ...SITE_METADATA, title: "Privacy - EasyEdit" };
export const viewport: Viewport = SITE_VIEWPORT;

export default function PrivacyPage() {
  return (
    <SitePage current="privacy">
      <main className={LEGAL_MAIN}>
        <article className={LEGAL_ARTICLE}>
          <h1 className={LEGAL_TITLE}>Privacy</h1>

          <h2 className={LEGAL_H2}>What we collect</h2>
          <p>
            When you sign in with Google, EasyEdit gets your name, email address and profile picture. It also keeps what you make: your projects
            and the media you upload. That media is stored in the Google Drive the space uses, not on EasyEdit&apos;s own servers: a Google
            account someone in the space connected. For Seattle Solvers, that is the team&apos;s shared drive.
          </p>

          <h2 className={LEGAL_H2}>What EasyEdit can see in your Google Drive</h2>
          <p>
            EasyEdit asks Google for one permission, <code>drive.file</code>. It lets EasyEdit see only the files and folders that EasyEdit itself
            creates in your Drive. It cannot see anything else in your Drive.
          </p>
          <p>
            EasyEdit&apos;s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
            <a className="underline underline-offset-4" href="https://developers.google.com/terms/api-services-user-data-policy">
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <p>
            The access EasyEdit keeps for a connected Google Drive is stored encrypted, and is used only to store and play the videos you add to
            EasyEdit.
          </p>

          <h2 className={LEGAL_H2}>Posting to YouTube</h2>
          <p>
            A space&apos;s admin can connect a YouTube channel so the space can post its videos there. EasyEdit uses YouTube API Services for
            this. It asks Google for permission to upload videos to the channel and to read the channel&apos;s name. It keeps the access to the
            channel encrypted, and keeps the channel&apos;s name, the Google account&apos;s address, and a list of what was posted, by whom and
            when. A video goes from your browser straight to YouTube, and only when someone presses Post.
          </p>
          <p>
            What Google does with it is in the{" "}
            <a className="underline underline-offset-4" href="https://policies.google.com/privacy">
              Google Privacy Policy
            </a>
            . To end EasyEdit&apos;s access, disconnect the channel in the space&apos;s settings, or remove EasyEdit on your Google
            account&apos;s{" "}
            <a className="underline underline-offset-4" href="https://myaccount.google.com/permissions">
              permissions page
            </a>
            .
          </p>

          <h2 className={LEGAL_H2}>Where your data lives</h2>
          <p>
            Accounts and projects are kept in a Neon database. The website runs on Vercel. Your media is kept in Google Drive. These companies
            process the data for us.
          </p>

          <h2 className={LEGAL_H2}>Auto captions</h2>
          <p>
            Auto captions run in your browser. Your audio is not sent anywhere to be transcribed. The first time you use them, your browser downloads
            the speech model from Hugging Face.
          </p>

          <h2 className={LEGAL_H2}>AI agents</h2>
          <p>An AI agent can work on your projects only after you connect it to your account. It acts with your connection, and you can disconnect it.</p>

          <h2 className={LEGAL_H2}>Deleting your data</h2>
          <p>
            To have your data deleted, email{" "}
            <a className="underline underline-offset-4" href="mailto:privacy@arush.dev">
              privacy@arush.dev
            </a>
            .
          </p>

          <h2 className={LEGAL_H2}>Rules for using EasyEdit</h2>
          <p>
            The rules are in the{" "}
            <Link href="/terms" className="underline underline-offset-4">
              terms of service
            </Link>
            .
          </p>

          <h2 className={LEGAL_H2}>Contact</h2>
          <p>
            Questions about privacy:{" "}
            <a className="underline underline-offset-4" href="mailto:privacy@arush.dev">
              privacy@arush.dev
            </a>
          </p>
        </article>
      </main>
    </SitePage>
  );
}
