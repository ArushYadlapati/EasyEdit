// Where each chapter starts and when each line is said in the intro tutorial video, in seconds. Made by the
// recording script together with the video file, so it matches one recording: replace both together.

export const TUTORIAL_SECONDS = 212.3;

// The credit the video's voice asks for, shown in the tutorial's title; null when it asks for none.
export const TUTORIAL_VOICE_CREDIT: string | null = "elevenlabs.io";

export const TUTORIAL_CHAPTERS: readonly { title: string; start: number }[] = [
  { title: "Welcome", start: 0 },
  { title: "Spaces", start: 9 },
  { title: "Dashboard", start: 26.33 },
  { title: "New project", start: 44.57 },
  { title: "Editor basics", start: 58.03 },
  { title: "Editing", start: 82.27 },
  { title: "Shortcuts", start: 121.1 },
  { title: "Team", start: 142.47 },
  { title: "AI agents", start: 169.17 },
  { title: "Export", start: 192 },
];

export const TUTORIAL_CAPTIONS: readonly { start: number; end: number; text: string }[] = [
  { start: 0.7, end: 5.52, text: "Welcome to EasyEdit, a video editor your whole team works in together." },
  { start: 5.97, end: 8.24, text: "Here are the basics, in a few minutes." },
  { start: 10.61, end: 15.88, text: "Everything lives in a space. A team space is shared with everyone on the team." },
  { start: 16.38, end: 21, text: "My Spaces lists the spaces you belong to. Click one to switch." },
  { start: 21.45, end: 25.93, text: "Each space has a brand kit: its fonts, colors and logos." },
  { start: 27.84, end: 33.89, text: "On the dashboard, Recent shows what you opened last. All projects shows everything." },
  { start: 34.34, end: 37.47, text: "Drag a project onto a folder to keep things tidy." },
  { start: 38.39, end: 41.98, text: "Pin a project, and it stays in the sidebar for the whole team." },
  { start: 45.97, end: 48.73, text: "To start a video, click New project." },
  { start: 49.18, end: 52.21, text: "Name it, and pick a format for where you'll post it." },
  { start: 53.86, end: 56.25, text: "Create it, and it opens in the editor." },
  { start: 59.03, end: 60.91, text: "The editor has four parts." },
  { start: 61.36, end: 65.57, text: "On the left, add text, media, or pieces of your brand kit." },
  { start: 66.1, end: 72.12, text: "The preview shows your video. Inspect, on the right, changes whatever is selected." },
  { start: 72.57, end: 76.28, text: "The timeline arranges your clips in time, on tracks." },
  { start: 76.73, end: 80.82, text: "There's no save button. Every change is saved as you make it." },
  { start: 83.57, end: 89.07, text: "Upload video, images or audio in the Media tab. Your team shares them." },
  { start: 89.52, end: 91.78, text: "Click a clip to add it at the playhead." },
  { start: 93.23, end: 95.63, text: "Drag a clip's edge to trim it." },
  { start: 96.56, end: 101.27, text: "Press S to split a clip at the playhead, then delete what you don't want." },
  { start: 102.55, end: 106.19, text: "Add a title from the Text tab, and double-click it to type." },
  { start: 108.51, end: 112.27, text: "Change its font, size and color in Inspect." },
  { start: 114.14, end: 115.93, text: "Press Space to play it back." },
  { start: 122.1, end: 124.55, text: "The keyboard is the fastest way to edit." },
  { start: 125.46, end: 129.57, text: "J, K and L play backward, pause, and play forward." },
  { start: 130.3, end: 135.84, text: "V, C and T switch tools. Undo with Command or Control Z." },
  { start: 136.29, end: 140.41, text: "Press the question mark to see every shortcut, and change any of them." },
  { start: 143.77, end: 146.98, text: "Teammates can work in the same project at the same time." },
  { start: 148.16, end: 150.87, text: "You can see who's here and what they have selected." },
  { start: 152.21, end: 155.17, text: "Their changes reach your screen in a few seconds." },
  { start: 155.92, end: 161.32, text: "Activity lists every change. You can undo any of them, even a teammate's." },
  { start: 161.77, end: 166.11, text: "In Members, an admin adds people and sets each person's role." },
  { start: 170.47, end: 174.98, text: "AI agents like Claude and ChatGPT can edit alongside you." },
  { start: 175.43, end: 178.62, text: "Connect one from AI agents, in your account menu." },
  { start: 180.64, end: 183.22, text: "Then just ask, in plain words." },
  { start: 183.67, end: 189.74, text: "The agent's change appears in your project and in Activity, and you can undo it like any other." },
  { start: 193.3, end: 195.46, text: "When you're done, click Export." },
  { start: 195.91, end: 201.24, text: "Your video renders as an MP4 right in your browser. Nothing is uploaded." },
  { start: 203.23, end: 208.79, text: "That's the basics. Watch this again any time from Tutorial, in your account menu." },
];
