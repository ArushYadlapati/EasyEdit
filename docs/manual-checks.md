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
18. Select a video clip and open **Effects** (right of Activity): it shows Transitions and Keyframes, and Inspect no longer has Transitions. Click the Scale diamond in Inspect at two playhead times, then in Effects change the first keyframe's time to 1 s, its value to 120 % and its ease to Ease out: each change is one undo step and the preview follows. **Go to** moves the playhead to the keyframe; **Delete** and **Clear** remove them.

## What to click to check templates

Do this once after a change to templates. It takes about ten minutes.

1. On the dashboard, start a new project from each of the three starters. Each opens with its placeholders and titles in place.
2. In one, select an empty slot. The details panel says to drop a file from Media onto it. Drag a video from the Media tab onto the slot on the timeline: the dashed box is the slot's own span, the slot fills and keeps its place. Undo once and it is empty again.
3. Select another empty slot and click a video in Media: it fills. Drop a video shorter than the slot: a notice says there is a gap after it.
4. Mark two clips of a project as slots, choose **Save as template**, and save. Save again with the same name: it says the name is taken and offers **Replace it**. Choose it.
5. On the dashboard start a new project from that template. Its slots are empty and the other clips are in place.
6. Connect Claude. Ask it to list the templates, start a project from yours and fill the slots with media. It reports a gap when the footage is shorter than the slot.
7. Put an intro clip that is not a slot in a template, then try to delete that file in the Media tab. It is refused and names the template.
8. Export a project that still has an empty slot. The dialog says how many slots are still empty and names them.
9. Open the Templates page as a viewer. There is no Edit or Delete, and no sentence telling you to save one.

## What to click to check captions

Speech-to-text runs in a real browser, so it cannot be tested without one. Do this once after a change to captions. You need a video with clear English speech, about a minute long, and about fifteen minutes.

1. Open a project and add the video to the timeline. Open the **Captions** tab (third in the left panel). Select the clip and click **Auto captions**. The first time, a row says "Getting the speech model… 42%" with "A one-time download." under it, then "Reading the sound…", then "Listening… 0:30 of 1:05". There is a **Cancel** button the whole time.
2. When it ends, a Captions track appears with a block for each line, the lines are listed in the tab, and the preview shows the words as they are spoken. Click **Auto captions** again on a fresh project with the same file: it says "Using saved captions…" and finishes at once, with no download.
3. Press Play and compare the words with the speech. Click a line's time in the tab and a block on the Captions track: the playhead jumps to that line.
4. Move the clip later on the timeline, trim its start by a few seconds, then split it in the middle. In each case the captions stay with the speech, none show outside the clip, and no step beyond the edit was needed. Change its speed to 2: the captions run twice as fast.
5. Under **Style**, click each look: **Block**, **Karaoke** (the spoken word is highlighted), **One word** and **Bar**. The preview changes each time and the pressed button is shown. Change the font, size, text color, highlight color, position and Uppercase.
6. In the tab, retype one caption line with fewer words, then one with more, and press Enter. The preview shows the new words, timed inside the old line. Retype another and press Escape: the old words come back.
7. Press undo after each change: the style, the line and then **Auto captions** itself (the track, the style and the words go together). Press redo and they come back.
8. Hide the Captions track with its eye: the captions leave the preview. Show it again: they return.
9. Click **Export** and export the project. Open the file: the captions are there in the same look, place and timing as the preview.
10. Click **Remove captions**: the captions go and the clip plays as before. Click **Auto captions** again, then **Transcribe again**, and it listens again rather than using the saved words.
11. Select a still image and click **Auto captions**: it says there is nothing to caption. Try a video with no speech (music only): it says "No speech found in" the file's name and the project is unchanged.
12. Click **Auto captions** and **Cancel** halfway: the button works again and the project is unchanged.
13. Sign in as a second person on another browser, open the same project and add the same file to a new project: **Auto captions** says "Using saved captions…" and no model download starts.
14. As a viewer, the Captions tab's buttons and fields are all dimmed.

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

## What to click to check moving a project between spaces

Moving copies media between two real Google Drives, so it needs a real browser and a real sign-in. Do this once after a change to moving. You need two spaces you can edit in that both have storage (your Personal space and a team will do), and about ten minutes.

1. In the first space, make a project with a video (with its small preview), an image and a song, and put all three on the timeline. Make a change or two, so there is something to undo.
2. On the dashboard, open the project's menu and choose **Move to…**. The dialog lists your other spaces. **Move** stays dimmed until you choose one.
3. Choose the other space and click **Move**. It says "Copying 0 of 6 files" (up to 6: the video, its preview and its picture, the image and its picture, and the song; fewer when some of those don't exist yet) and counts up, with a bar. Press Escape and click the close button: nothing happens. Try to close the tab: the browser asks first.
4. When it ends you land on the other space's dashboard. The project is there, opens, plays with its video, image and song, and shows its picture. It is gone from the first space.
5. In the editor, undo: changes made before the move are not undone. The video plays from its preview.
6. Move it back, the other way (team to personal, then personal to team). Do both directions once.
7. Move it again, and close the tab halfway through the copy (use a large video). Open the dashboard: the project is still in the first space and works. Choose **Move to…** again: it carries on and finishes, copying only what is left.
8. Start another move and click **Cancel** halfway. The dialog goes back to the choices, and the project is where it was.
9. Open the project in the editor in a second tab, then move it from the dashboard. The second tab says the project was moved and does not let you keep editing.
10. Pick a space with no storage: the dialog says so. As that space's admin it shows **Set up storage**; as an editor it says to ask an admin and has no link.
11. Start a project from a template and leave one of its slots empty. Give a video clip a **Zoom** transition in, then move the project to your other space. It moves, opens there with the slot still empty and the zoom in place, and exports: the empty slot is a black or silent gap, and the zoom plays as it does in the preview.

## Checking an exported file

`pnpm check:export` reads a finished file with ffmpeg (`brew install ffmpeg`) and checks what a player needs: H.264, the right size, the exact frame rate and length, keyframes, the sound track. It can also compare frames of the video with frames the editor saved.

1. In the editor, put the playhead on the first frame, open **Export** and click **Save frame as image**. Do the same on a frame in the middle and on the last frame. Use the same size you exported.
2. Run, with your own file names:

   `pnpm check:export "Test reel.mp4" --size 1080x1920 --fps 30 --still "Test reel frame 000000.png" --still "Test reel frame 000045.png" --still "Test reel frame 000089.png"`

   For a frame with video or a picture in it, or with a placeholder where media is missing ("Media removed" and the like), pass it with `--media-still` instead of `--still`.

   Add `--no-audio` when the done screen said "This file has no sound track."; otherwise add `--sound` when the project has sound, or `--silent` when it has none. `--onset 45` checks that the first sound starts on frame 45, to within one AAC frame.

Every line should say PASS. A FAIL on a frame line means the video does not match what the editor drew. This check is run by hand; it is not part of `pnpm test`.
