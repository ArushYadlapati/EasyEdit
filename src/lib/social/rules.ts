import { LIMITS } from "@/lib/limits";

// What a post to YouTube may hold, checked the same way in the form and on the server. No server code in here.

export const VISIBILITIES = ["private", "unlisted", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: "Private (only you and people you choose)",
  unlisted: "Unlisted (anyone with the link)",
  public: "Public (everyone)",
};

export type PostForm = { title: string; description: string; visibility: Visibility; madeForKids: boolean };

export const isVisibility = (value: unknown): value is Visibility => VISIBILITIES.some((known) => known === value);

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
const ANGLE = /[<>]/;

// What is wrong with the form, as a sentence for the person, or null. YouTube refuses < and > in both fields.
export function postFormProblem(form: PostForm): string | null {
  const title = form.title.trim();
  if (title === "") return "Give the video a title.";
  if ([...title].length > LIMITS.socialTitleChars) return `A title can be up to ${LIMITS.socialTitleChars} characters.`;
  if (ANGLE.test(title)) return "A title can't contain < or >.";
  if (utf8Bytes(form.description) > LIMITS.socialDescriptionBytes) return "The description is too long for YouTube (5,000 characters at most).";
  if (ANGLE.test(form.description)) return "A description can't contain < or >.";
  if (!isVisibility(form.visibility)) return "Choose who can see the video.";
  return null;
}

// The title the form starts with: the project's name, made to fit YouTube's rules.
export function defaultTitle(projectName: string): string {
  return [...projectName.replace(/[<>]/g, "").trim()].slice(0, LIMITS.socialTitleChars).join("");
}

export const SHORT_MAX_SECONDS = 180;

// YouTube shows a video as a Short when it is square or taller and three minutes or less. Nothing is sent for it.
export function showsAsShort(video: { width: number; height: number; seconds: number }): boolean {
  return video.height >= video.width && video.seconds > 0 && video.seconds <= SHORT_MAX_SECONDS;
}

// A YouTube video id, and nothing else: it goes into a link.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (value: unknown): value is string => typeof value === "string" && VIDEO_ID.test(value);

export const videoUrl = (videoId: string) => `https://youtu.be/${videoId}`;
