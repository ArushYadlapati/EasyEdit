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

Speech-to-text runs in a real browser, so it cannot be tested without one. Do this once after a change to captions. You need a video with clear English speech, about a minute long, a second video that has music and no speech, a still image, and about fifteen minutes. Steps 1 to 11 use one project (call it project A) and the speech video.

1. Open project A and add the speech video to the timeline. Open the **Captions** tab (third in the left panel). Select the clip and click **Auto captions**. A row says "Checking for saved captions…", then "Reading the sound…", then "Getting the speech model… 42%", then "Listening… 0:30 of 1:05". The first time, when the model takes more than two seconds to download, "A one-time download." shows under the model line. A **Cancel** button shows while it runs.
2. When it ends, a Captions track appears with a block for each line, the lines are listed in the tab, and the preview shows the words as they are spoken. Press Play and compare the words with the speech. Click a line's time in the tab and a block on the Captions track: the playhead jumps to that line.
3. Press undo once: the Captions track, the captions and the style all go together. Press redo: they all come back.
4. Move the clip later on the timeline, trim its start by a few seconds, then split it in the middle. In each case the captions stay with the speech and none show outside the clip.
5. Under **Style**, click each look: **Block**, **Karaoke** (the spoken word is highlighted), **One word** and **Bar**. The preview changes each time and the pressed button is shown. Change the font, size, text color, highlight color, position and Uppercase. Both color boxes show the whole value, such as `#ffffff`. Press undo after one change: that change goes, and redo brings it back.
6. In the tab, retype one caption line with fewer words, then one with more, and press Enter. The preview shows the new words, timed inside the old line. Retype another and press Escape: the old words come back. Press undo once: the last retyped line's old words return. Press redo to bring the new words back.
7. Click an empty part of the timeline so nothing is selected, and click **Auto captions** again. It finishes at once, and the lines you retyped in step 6 still read as you typed them.
8. Hide the Captions track with its eye: the captions leave the preview. Show it again: they return.
9. Click **Export** and export the project. Open the file: the captions are there in the same look, place and timing as the preview.
10. Select the first half of the split clip and click **Remove captions**: its captions go and it plays as before, while the second half keeps its captions (Remove captions applies to the selected clips only). With the first half still selected, click **Auto captions** again: its captions come back at once, with no model download, and your retyped lines are as you left them. Click **Transcribe again**: it listens to the file again and replaces its captions, retyped lines included.
11. With the first half still selected, click **Transcribe again** and click **Cancel** while it says "Listening…": the buttons work again and the captions are as they were.
12. Add the still image to project A's timeline and select only it: **Auto captions** is greyed out, and the line under it reads "Select a video or audio clip, or select nothing to caption every clip with sound." In a new project (project B), add the music-only video and click **Auto captions**: it says "No speech found in" the file's name, and the project is unchanged.
13. As a second person on another browser, in the same space, start a new project (project C) and add the same speech video from Media. Click **Auto captions** on it: it says "Checking for saved captions…", then "Using saved captions…", and no model download starts.

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

## What to click to check posting to YouTube

Posting needs a real YouTube channel and a real sign-in, so do this once after a change to posting. You need a space you are an admin of, on a server with the YouTube settings ([Posting to YouTube](setup.md#posting-to-youtube)), and a channel you don't mind test videos on.

1. Open the space's settings. There is a **Socials** tab. As an editor of the same space there is none.
2. Click **Connect a YouTube channel**. Google asks which account, then which channel, then for two permissions. Allow both. You land back on Socials with "YouTube channel connected." and the channel's name.
3. Connect again and untick the upload permission: it says EasyEdit needs it, and the channel shown is unchanged.
4. Open a project in that space and export it. The finished screen has **Post to YouTube**.
5. Click it. The title is the project's name and "Who can see it" is Private. For an upright project of three minutes or less it says the video will show as a Short.
6. Click **Post**. A bar shows the upload. Close the dialog and open it again: the upload is still going. When it ends there is an **Open on YouTube** link, and the video is on the channel, private, with your title.
7. Post again with a large export and click **Cancel** halfway: it goes back to the form, and no video appears on the channel.
8. Post again, and turn Wi-Fi off for ten seconds halfway. It carries on when the connection is back.
9. Back on Socials, **Recent posts** lists what you posted and what you stopped.
10. As an editor of the space (a second account), export and post: it works, to the same channel. As an editor there is still no Socials tab.
11. Connect the channel as a second admin of a team, then have that admin leave the team. The channel is gone from Socials.
12. **Disconnect**. The page says the channel is disconnected, the Export dialog no longer offers Post, and in your Google account (Security, Third-party access) EasyEdit no longer has YouTube access.

## What to click to check the Style page

A video is looked at in a real browser, and an agent reads the style through a real connection, so neither can be tested without them. Do this once after a change to the Style page or to how agents read a style. You need a team you can edit in, with storage set up, two videos in its media (one with clear English speech), a project or two, Claude connected to your account ([Connect an AI agent](ai-agents.md)), and about fifteen minutes.

1. Open the team's settings and click **Style** (or **Style** in the sidebar, under **Brand kit**). It says "Show AI agents how your videos look and feel." Under **Learn from your videos** it says "No videos yet. Add one or two that feel most like you.", and the fields under **Your style** are empty.
2. Click **Add a video** and pick the speech video. Its card comes first in the list and reads "Looking at the shots…" with a percentage, then "Listening…", then "Saving…". The first time on this computer, Listening waits while the speech model downloads. When it ends, the card shows a strip of frames from the video and a line such as "38 s · 24 shots, about 1.6 s each · talks 170 words a minute". Reload the page: the card and its strip are the same, and the video is not looked at again.
3. Open **Add a video** again: the speech video says "In your style". Pick the second video. If another video is still being looked at, the new card says "Waiting its turn…" first.
4. Click **Paste a link**, paste the address of a YouTube video and click **Add link**. Its card shows the video's picture and title, with "YouTube" and the channel's name. Click the title: the video opens on YouTube in a new tab. Add a YouTube Shorts link too: its card says "YouTube Short".
5. Paste the address of an Instagram post or reel. Before you click anything it says "Instagram doesn't let other apps read posts. Download your video from Instagram and upload it here instead." **Upload a video instead** opens Add a video. Paste `https://example.com` and click **Add link**: it says "Paste a link to a YouTube, Vimeo or TikTok video."
6. Click **Pick past projects**, tick two projects and click **Add 2 projects**. Each gets a card such as "Project · 42 s · 18 shots, about 2.1 s each · 3 transitions".
7. Under **Your style**, type a sentence in **In a sentence or two**, then click **Fill in from my videos**. It says how many fields it filled in, marks each of them "Filled in", and leaves your sentence as you typed it.
8. Change **Pace**, add one line under **Always** and one under **Never**, and click **Save**. It says "Saved." and "Last changed by <your name>, just now". Reload: everything is as you saved it.
9. Remove the Shorts link with the **×** on its card. It goes, and is still gone after a reload.
10. Open a project in this team and click the editor's **Brand kit** tab. At the bottom, the **Style** card shows your sentence, and **Edit style** goes back to the Style page.
11. Under **Try it**, click **Copy**. In a new chat on claude.ai, paste it ("Edit my latest project in the <team> style.") and send it. Before its first edit, Claude calls `get_editing_guide` with your team as `space` (open the tool call to see it), and its plan follows the style: the pace, the captions and what is under **Always** and **Never**.
12. Ask Claude "Show me the frames from my style videos." It calls `get_editing_guide` with topic `style` and your team, gets the strips as pictures, and can say what is in them: the caption looks, the framing and the colors.
13. Ask Claude to add "no zoom transitions" under Never. It tells you what it will save and waits for a yes, then calls `save_style`. Reload the Style page: **Never** has the new line, and it says "Last changed by Claude (for <your name>)" and how long ago.
14. Open the **AI agents** page. Under **Video skills**, click **Download easyedit-video.zip**. Unzipped, it holds an `easyedit-video` folder with `SKILL.md` and a `references` folder of 14 files. Open `/skills/easyedit-video.zip` in a private window: it downloads there too, with no sign-in.
15. On a server with posting to YouTube set up, and the team's channel connected in **Socials**: click **From your YouTube channel**. It lists the channel's newest videos. Click **Add** on one: its card says "Your YouTube channel". Then **Disconnect** the channel in Socials and come back to Style: that card is gone, and the YouTube link from step 4 is still there.

## Checking an exported file

`pnpm check:export` reads a finished file with ffmpeg (`brew install ffmpeg`) and checks what a player needs: H.264, the right size, the exact frame rate and length, keyframes, the sound track. It can also compare frames of the video with frames the editor saved.

1. In the editor, put the playhead on the first frame, open **Export** and click **Save frame as image**. Do the same on a frame in the middle and on the last frame. Use the same size you exported.
2. Run, with your own file names:

   `pnpm check:export "Test reel.mp4" --size 1080x1920 --fps 30 --still "Test reel frame 000000.png" --still "Test reel frame 000045.png" --still "Test reel frame 000089.png"`

   For a frame with video or a picture in it, or with a placeholder where media is missing ("Media removed" and the like), pass it with `--media-still` instead of `--still`.

   Add `--no-audio` when the done screen said "This file has no sound track."; otherwise add `--sound` when the project has sound, or `--silent` when it has none. `--onset 45` checks that the first sound starts on frame 45, to within one AAC frame.

Every line should say PASS. A FAIL on a frame line means the video does not match what the editor drew. This check is run by hand; it is not part of `pnpm test`.
