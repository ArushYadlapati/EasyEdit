# Manual checks

Some behavior cannot be covered by `pnpm test` because it needs a real Google sign-in and a real browser. These are the click-through lists to run after changing the editor or export.

## What to click to check the editor

The editor cannot be opened without a Google sign-in, so the tests cannot click through it. Do this once after a change to the editor, signed in on your own computer. It takes about ten minutes. Use an editor account, and a second account in another browser profile for lines 9, 10, 11 and 13.

1. Open a project from the dashboard. The editor fills the window, dark, with no site header. The top bar shows "Projects", the project's name and "Saved".
2. In the left panel click **Title**. A clip appears on Text 1 at the playhead and the preview shows "Your title". The status flips to "Saving…" and back to "Saved".
3. With the clip selected, type in **Text** in the inspector. The preview follows as you type. Change **Size** and **Color**. Click away: each change is saved once.
4. Drag the clip to the right. It snaps to whole seconds and a guide line shows. Drag its right edge to make it shorter.
5. Put the playhead in the middle of the clip and press `S`: it becomes two clips. Select the second and press `Delete`. Press `Cmd/Ctrl+Z`: it comes back. Press `Shift+Cmd/Ctrl+Z`: it goes again.
6. Click **Subtitle** with the playhead over the first clip. It lands on a new track, "Text 2", in the row just above Text 1: a new track goes just in front of the other tracks of its kind. Open that track's options: **Move down**, then **Move up**. Lock it, then hide it: its text leaves the preview.
7. Select a clip, press `Cmd/Ctrl+C`, move the playhead, press `Cmd/Ctrl+V`. A copy appears at the playhead and is selected.
8. Press `Space` to play and `K` to stop. Click a button such as **Safe zones**, then press `Space`: it plays, and the button is not pressed again. Try `L` twice (2×), `J`, the arrow keys, `Home` and `End`. Turn **Safe zones** off and on. With nothing selected, switch **Format** to Long 16:9: the canvas changes shape.
9. In the second profile open the same project and move a clip. Within about two seconds the first window shows the move and "<name> is editing…". Open **Activity** in the first window: both people's changes are listed. Click **Undo this change** on the other person's move: it moves back in both windows.
10. In the second profile select a clip. Within a few seconds the first window rings it on the timeline in a colour, outlines it on the preview with that person's name (when the playhead is over it), and shows their dot in the top bar. Click the dot: the playhead moves to that clip. Select a track in the second profile: its row gets a coloured bar and lines. Close the second window: the marks go within a few seconds. Switch it to another browser tab instead: they go within about a minute.
11. Change a clip's text in the first window, then change the same text in the second. In the first window press `Cmd/Ctrl+Z`. It says "Can't undo. This was changed afterwards." and the second person's text stays.
12. In the browser's developer tools set the network to Offline and move a clip. The status reads "Offline. Changes will save when you reconnect." Click **Projects**: the browser asks before leaving; stay on the page. Go back online: it reads "Saved". Reload: the move is still there.
13. On the Admin page open the second account's role. It offers Admin and Editor only: there is no view-only role.
14. Sign out in another tab, then move a clip in the editor. It says "You're signed out. Sign in again to save your changes." and the status reads "Signed out". Click **Sign in**: it opens in a new tab. Sign in there and come back to the editor: the status returns to "Saved" and the move is kept.
15. Press `?`. The list of shortcuts opens. Close it with `Escape`.
16. Make the window narrower than 1024 px. The editor is replaced by "The editor needs a wider window."
17. Add a title. Once the status reads "Saved", wait ten seconds, then click **Projects**: the project's card shows the title on its picture.

## What to click to check export

Export cannot be tested without a real browser and a real sign-in. Do this once after a change to export. It takes about five minutes.

1. Open a project. Add a **Title** and a **Subtitle**. Give the title the color `#ffd400`. Type `Žofia & Ángel 🤖` into the subtitle.
2. From the Media tab, add a video and an image. Split the video once, and crop the image in the details panel. Add a song to the audio track.
3. Click **Export** (or press `Cmd/Ctrl+E`). The dialog shows the size, 30 fps, the length, and "Up to about …".
4. Click **Export video** and choose where to save. It says it is reading the media, the frames count up, and it ends with "Saved" and the file's name.
5. Open the file. It plays to the end, its length matches the dialog, and it looks like the preview: same font, same line breaks, same colors, the same moment of each clip. The song and the video's own sound play as they do in the preview. Send it to a phone and play it there.
6. Make a clip one minute long, export again and click **Cancel** halfway. The dialog goes back to the choices. No new file is left where you saved; a file you chose to replace is unchanged.
7. Start one more export, switch to another tab until it should be done, and come back. It finished.

Before the team is told to use export, the owner runs this list once on a Windows laptop and once on a Chromebook the team uses.

## Checking an exported file

`pnpm check:export` reads a finished file with ffmpeg (`brew install ffmpeg`) and checks what a player needs: H.264, the right size, the exact frame rate and length, keyframes, the sound track. It can also compare frames of the video with frames the editor saved.

1. In the editor, put the playhead on the first frame, open **Export** and click **Save frame as image**. Do the same on a frame in the middle and on the last frame. Use the same size you exported.
2. Run, with your own file names:

   `pnpm check:export "Test reel.mp4" --size 1080x1920 --fps 30 --still "Test reel frame 000000.png" --still "Test reel frame 000045.png" --still "Test reel frame 000089.png"`

   For a frame with video or a picture in it, or with a placeholder where media is missing ("Media removed" and the like), pass it with `--media-still` instead of `--still`.

   Add `--no-audio` when the done screen said "This file has no sound track."; otherwise add `--sound` when the project has sound, or `--silent` when it has none. `--onset 45` checks that the first sound starts on frame 45, to within one AAC frame.

Every line should say PASS. A FAIL on a frame line means the video does not match what the editor drew. This check is run by hand; it is not part of `pnpm test`.
