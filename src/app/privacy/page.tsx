import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SITE_METADATA, SITE_VIEWPORT, SitePage } from "@/components/site/site-page";
import { LEGAL_ARTICLE, LEGAL_MAIN, LEGAL_TITLE } from "@/app/legal";
import { LegalContents, LegalH2 } from "@/app/legal-contents";

export const metadata: Metadata = { ...SITE_METADATA, title: "Privacy · EasyEdit" };
export const viewport: Viewport = SITE_VIEWPORT;

// The page's section headings, in order, for the list beside the text (a test checks they match the headings).
const SECTIONS = [
  "What we collect",
  "What EasyEdit can see in your Google Drive",
  "Posting to YouTube",
  "Where your data lives",
  "Auto captions",
  "AI agents",
  "Your style",
  "Deleting your data",
  "Rules for using EasyEdit",
  "Contact",
];

export default function PrivacyPage() {
  return (
    <SitePage current="privacy">
      <main className={LEGAL_MAIN}>
        <LegalContents sections={SECTIONS} />
        <article className={LEGAL_ARTICLE}>
          <h1 className={LEGAL_TITLE}>Privacy</h1>

          <LegalH2>What we collect</LegalH2>
          <p>
            When you sign in with Google, EasyEdit gets your name, email address and profile picture. It also keeps what you make: your projects
            and the media you upload. That media is stored in the Google Drive the space uses, not on EasyEdit&apos;s own servers: a Google
            account someone in the space connected. For Seattle Solvers, that is the team&apos;s shared drive.
          </p>

          <LegalH2>What EasyEdit can see in your Google Drive</LegalH2>
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

          <LegalH2>Posting to YouTube</LegalH2>
          <p>
            A space&apos;s admin can connect a YouTube channel so the space can post its videos there. EasyEdit uses YouTube API Services for
            this. It asks Google for permission to upload videos to the channel and to view the channel. EasyEdit reads the channel&apos;s name
            and, when someone picks videos from it for the space&apos;s style, the details of those videos (see{" "}
            <a className="underline underline-offset-4" href="#your-style">
              Your style
            </a>
            ). It keeps the access to the channel encrypted, and keeps the channel&apos;s name, the Google account&apos;s address, and a list
            of what was posted, by whom and when. A video goes from your browser straight to YouTube, and only when someone presses Post.
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

          <LegalH2>Where your data lives</LegalH2>
          <p>
            Accounts, projects and styles are kept in a Neon database. The website runs on Vercel. Your media is kept in Google Drive. These
            companies process the data for us.
          </p>

          <LegalH2>Auto captions</LegalH2>
          <p>
            Auto captions run in your browser. Your audio is not sent anywhere to be transcribed. The first time you use them, your browser downloads
            the speech model from Hugging Face.
          </p>

          <LegalH2>AI agents</LegalH2>
          <p>An AI agent can work on your projects only after you connect it to your account. It acts with your connection, and you can disconnect it.</p>

          <LegalH2>Your style</LegalH2>
          <p>
            Each space can keep a style: how its videos usually look and feel, so AI agents can edit the same way. When you add one of the
            space&apos;s videos to it, EasyEdit looks at the video in your browser. It saves what it found in EasyEdit&apos;s database: the
            video&apos;s length and shape, where its shots change, how fast people talk and the first words they say, how loud it is, its
            overall colors, and a small strip of frames from it. The video itself stays in your storage. To hear the words, your browser uses
            the same speech model as Auto captions, and the words are kept with the video so Auto captions can use them too.
          </p>
          <p>
            For a link, EasyEdit asks YouTube, Vimeo or TikTok for the video&apos;s public title, author and picture (and from Vimeo, its length
            and description). It never gets the video itself. The picture is shown from that site&apos;s own servers.
          </p>
          <p>
            When the space&apos;s YouTube channel is connected, the Style page can list the channel&apos;s newest public videos. It never
            lists private or unlisted ones. For each one you pick, EasyEdit keeps its title, channel name, description, tags, length and
            picture from YouTube. After 30 days EasyEdit stops using them, and within a day it deletes all but the video&apos;s address.
            Refresh reads them from YouTube again. When the channel is disconnected, or another channel takes its place, those videos are
            deleted from the style. If you remove EasyEdit on your Google account&apos;s permissions page instead, they are deleted within a
            day.
          </p>
          <p>
            Everyone in the space, and the AI agents they connect, can see the style and what it learned. Removing a video, link or project from
            the style deletes what the style saved about it. The words kept for Auto captions stay with the video.
          </p>

          <LegalH2>Deleting your data</LegalH2>
          <p>
            To have your data deleted, email{" "}
            <a className="underline underline-offset-4" href="mailto:privacy@arush.dev">
              privacy@arush.dev
            </a>
            .
          </p>

          <LegalH2>Rules for using EasyEdit</LegalH2>
          <p>
            The rules are in the{" "}
            <Link href="/terms" className="underline underline-offset-4">
              terms of service
            </Link>
            .
          </p>

          <LegalH2>Contact</LegalH2>
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
