import { LogoMark } from "@/components/ui/logo";

// Beside the sign-in on a computer: a drawn editor window with a still of real footage (Pexels, free to use, no credit
// required) and a title on it that an AI agent has selected (Codex, in its own colour), the way the home page draws
// its pictures. It only shows what comes next, so it is hidden from screen readers, and it is left out on a phone,
// where the sign-in is the whole page.
export function SignInPicture() {
  return (
    <figure data-ui aria-hidden className="h-signPicture ed-theme">
      <div className="h-signBar">
        <LogoMark size={16} />
        <span className="h-signProject">Untitled project</span>
        <span className="h-signSaved">Saved</span>
        <span className="h-signExport">Export</span>
      </div>
      <div className="h-signStage">
        <div className="h-signFrame">
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed still inside a drawn frame */}
          <img className="h-signStill" src="/home/scene-wave.webp" alt="" width={1280} height={720} decoding="async" />
          <span className="h-signTitle">
            Your next video
            <span className="h-signSel">
              <span className="h-signTag">Codex</span>
              <span className="h-signHandle" data-at="tl" />
              <span className="h-signHandle" data-at="tr" />
              <span className="h-signHandle" data-at="bl" />
              <span className="h-signHandle" data-at="br" />
            </span>
          </span>
        </div>
      </div>
    </figure>
  );
}
