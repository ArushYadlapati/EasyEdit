// The intro tutorial is offered only when the server is given the video's address (TUTORIAL_VIDEO_URL): an https
// link to an MP4, with a JPG of the same name beside it for the picture shown before it plays. Unset, or anything
// else, and there is no welcome dialog and no Tutorial item. Plain http is taken from this computer only, for trying
// a new recording out. A plain module, so the layout and the tests read the same switch.
export type TutorialVideo = { url: string; poster: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function tutorialVideo(env: NodeJS.ProcessEnv = process.env): TutorialVideo | null {
  const value = env.TUTORIAL_VIDEO_URL?.trim();
  if (!value) return null;
  let address: URL;
  try {
    address = new URL(value);
  } catch {
    return null;
  }
  const secure = address.protocol === "https:" || (address.protocol === "http:" && LOCAL_HOSTS.has(address.hostname));
  if (!secure || !/\.mp4$/i.test(address.pathname)) return null;
  const poster = new URL(address.href);
  poster.pathname = address.pathname.replace(/\.mp4$/i, ".jpg");
  return { url: address.href, poster: poster.href };
}
