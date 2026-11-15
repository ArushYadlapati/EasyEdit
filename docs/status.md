# Project status

What EasyEdit can do in its current release, and what is planned next. For roles, formats and limits, see [reference.md](reference.md).

## What works today

- Sign in with Google. Anyone not on the allowlist is turned away.
- An Admin page where admins add people, change their role, and remove them.
- A dashboard where editors create projects in one of five video formats or at a custom size (in pixels, centimeters or inches), keep them in folders, and rename, duplicate and delete them. Recent shows the projects you opened last. A deleted project is hidden and not shown again. Each card shows a picture of its project, which the editor draws a few seconds after a change is saved; a project changed from outside the editor shows its new picture once an editor opens it.
- The editor, which opens a project in the whole window: an add panel on the left, the preview in the middle, the details on the right and the timeline along the bottom. It is always dark, and it asks the Dark Reader browser extension to leave it alone. In it you can:
  - add text clips from three presets (Title, Subtitle, Lower third) and video, image and audio clips from the Media tab, and move, trim, split, delete, ripple-delete, copy and paste clips of every kind
  - add, rename, lock, hide, mute, reorder and remove tracks
  - play the project in the preview, with frame steps, J, K and L, and safe-zone guides for each format
  - undo and redo your own changes, and undo any change listed under Activity, including a teammate's
- Export: the **Export** button (or `Cmd/Ctrl+E`) makes an MP4 of the project on your own computer, in the browser; nothing is uploaded. You pick a size, watch the progress and can cancel, and you can keep editing while it runs. Video and image clips export from the files the editor plays, so video comes from its 720p preview copy. The sound is mixed as the preview plays it: each video's own sound and the audio tracks, at each clip's volume (up to 1), with muted tracks and hidden video tracks silent; a clip at another speed keeps its pitch. Without an AAC encoder (Firefox, Chrome on Linux) the file has no sound track; when the project has sound, the dialog says so before you export. Viewers can export too. It needs a recent Chrome or Edge on a computer.
- Upload video, images and audio in the editor's Media tab (up to 2 GB a file). Uploads go straight from your browser to the team's Google Shared Drive and resume after an interruption.
- Put media on the timeline, trim it, and play it in the preview. Each video gets a small 720p preview copy, so phone footage plays on any laptop.
- Every change is saved as you make it. Other people's changes show up within about two seconds while you are working, and the top bar says who is editing.
- Viewers get the same editor, read-only: they can play and look, but not change anything.
- A project API (see [The project API](api.md)).
- Claude, ChatGPT and other AI agents can list, read, create and edit projects for a signed-in member, through the connector (set up on the AI agents page). They can also list the team's media and put it on a timeline. A member can connect several agents at once.

The editor needs a window at least 1024 px wide. Changes made while offline or signed out wait in the open tab and are sent once you are back. They are not kept if the tab is closed or reloaded first, and the browser asks before that happens. The browser's Back button does not ask, so use **Projects** to leave while changes are waiting. Closing the tab or clicking **Projects** during an export asks first; the Back button does not, and cancels the export. Without a save dialog (Firefox, Safari), closing the tab or clicking **Projects** also asks while a finished video waits for **Download**. Keep the tab open until the export finishes: on battery, Chrome may pause a tab that is in the background. If the tab is closed, reloaded or crashes during an export, the empty file the save dialog made stays where you saved it.

## What's next

Spaces are live: a personal space for everyone alongside their teams, with a switcher. Next up is storage in each space's own Google Drive and open sign-up, team invites by email, a new sign-up flow, and moving projects between spaces. The [roadmap in the README](../README.md#roadmap) has the stages in order.

After that: thumbnails and waveforms on the timeline, transcripts and footage search for Claude, captions, text animation and effects, a brand kit and templates, full-quality video in exports, the render station, voiceover, and posting.
