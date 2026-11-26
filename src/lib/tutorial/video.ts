// The guide's videos are offered only when the server is given their address (TUTORIAL_VIDEO_URL): an https link to
// the first lesson's MP4, with a JPG of the same name beside it for the picture shown before it plays. Every other
// lesson's video and picture sit in the same folder, named by the lesson (lessonVideo). Unset, or anything else, and
// there is no Learn page, no Learn link and no welcome dialog. Plain http is taken from this computer only, for
// trying a new recording out. A plain module, so the layout and the tests read the same switch.
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

// A lesson's own video and picture. The first lesson's are the ones the setting names; any other lesson's are beside
// them, as <slug>.mp4 and <slug>.jpg. A query string on the setting (a version mark, say) is kept on all of them.
export function lessonVideo(video: TutorialVideo, slug: string, first: boolean): TutorialVideo {
  if (first) return video;
  const beside = (address: string, ending: string) => {
    const url = new URL(address);
    url.pathname = url.pathname.replace(/[^/]*$/, `${encodeURIComponent(slug)}.${ending}`);
    return url.href;
  };
  return { url: beside(video.url, "mp4"), poster: beside(video.poster, "jpg") };
}
