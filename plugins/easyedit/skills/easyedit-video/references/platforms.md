# Shorts, Reels, TikTok and YouTube

Read this when you pick a format or length for where a video will be posted, keep things inside the safe area, make a Short loop, or pace and chapter a long YouTube video.

## The short version

- Match the format to where the video goes: short_9x16 for Shorts, Reels and TikTok, feed_4x5 for feed posts, square_1x1 for square posts, long_16x9 for YouTube. Use long_4k only for 4K footage, when the person wants a 4K upload.
- Aim for 15 to 45 seconds in 9:16 unless the person or their style says otherwise. Long-form runs as long as the content needs, and no longer.
- Keep text, faces and the product inside the safe area. In 9:16 that keeps the top 14%, the bottom 35% and 6% at each side clear; every other format keeps 5% clear on each side. A "Safe area" line in `get_project` replaces these.
- Frame 0 is often the cover. Make it a finished picture with the hook already on screen.
- For a loop, end on a moment that leads straight back into the first frame. No fade to black, no "thanks for watching".
- In long-form, put a marker at each chapter start and give the person the timestamps for the description, starting at 0:00.
- You can't export or post. When the edit is done, give the editor link and tell the person how to export.
- Read the space's style first. Its formats and lengths beat every default here.

Numbers here assume 30 fps. Ops take whole frames, so multiply seconds by the project's fps: 10 seconds is 300 frames at 30 fps, 240 at 24 and 600 at 60.

## Pick the format for where it's going

| Format | Size | Where it goes | Length to aim for |
|---|---|---|---|
| short_9x16 | 1080 × 1920 | YouTube Shorts, Instagram Reels, TikTok, Stories | 15–45 s; 7–15 s for a loop or a teaser |
| feed_4x5 | 1080 × 1350 | Feed posts on Instagram, Facebook and LinkedIn | 15–60 s |
| square_1x1 | 1080 × 1080 | Square posts, and places that crop to a square | 15–60 s |
| long_16x9 | 1920 × 1080 | YouTube, a website, a screen at an event | As long as it needs, often 4–15 min |
| long_4k | 3840 × 2160 | YouTube in 4K, when the footage is 4K | Same as 16:9 |

If the person hasn't said where it's going, ask once: "Is this for Reels and TikTok, or for YouTube?" A wrong shape is the most expensive mistake to fix later, because every text clip and every wide shot has to be placed again.

**In EasyEdit.** `create_project` takes the format and the space. A blank project you make with `create_project` runs at 30 fps. One made in the editor, or from a template, can run at 24, 25, 50 or 60, so read the first line of `get_project`:

```text
Format short_9x16 1080x1920 @30fps · duration 28.00s · version 4
```

Use "custom" only when the person names a size, like a 1920 × 540 banner for a lobby screen. Give width and height in even pixels, 16 to 4096 a side and no more than the area of 4K.

To change an existing project's shape, use `set_format`:

```json
{"op":"set_format","format":"feed_4x5"}
```

Clips keep their x and y as shares of the new frame, and text keeps its size in pixels. So a title that fit across 1920 pixels may wrap in 1080, and a wide shot shows less of itself in a tall frame. Read the project again and check every text clip, the "Captions:" line and how each video is framed (see below).

A caption look someone set in the old shape keeps its look, y and size. From 16:9 that's y 0.79, behind the description in 9:16, and often block, the calmer look a wide project starts on. If the "Captions:" line still shows the old numbers, set them for the new shape (the 9:16 defaults are y 0.56 and 70 px, on karaoke):

```json
{"op":"set_caption_style","patch":{"y":0.56,"fontSize":70}}
```

When the person wants the same video in two shapes, change a copy. You can't copy a project yourself: ask them to pick Duplicate from the project's menu on the dashboard, then run `set_format` on the copy.

**The space's style.** Call `get_editing_guide` with the project's space. If it ends with "## This space's style", its formats field lists the shapes they post in and lengthSeconds gives a min and max. If formats lists several, ask which one this video is for. With no lengths saved, the facts for their reference videos and past projects show how long their videos usually run; aim near those.

If the person tells you where they post and wants it remembered, offer `save_style` with their space and fields such as formats `["short_9x16","feed_4x5"]` and lengthSeconds `{"min":20,"max":30}`. Saving needs an editor or admin, and every agent in the space reads it after, so ask first.

## Lengths that work

- **Shorts, Reels and TikTok:** 15 to 45 seconds. The apps take videos of several minutes, but a short video people watch to the end does better than a long one they leave. A vertical video over 3 minutes posts to YouTube as a regular video, not a Short.
- **Loops and teasers:** 7 to 15 seconds. A bakery's "fresh out of the oven" clip, a band's ten seconds of the chorus.
- **A how-to or a story that holds:** up to 60 or 90 seconds, if every part earns its place. A study channel's "three ways to remember dates" can run 50 seconds; a hype reel shouldn't.
- **Feed posts in 4:5 or 1:1:** 15 to 60 seconds. Many people watch them muted, so captions or text carry the message.
- **YouTube long-form:** as long as the content needs. A repair tutorial might run 8 to 12 minutes and a match recap 3 to 6. Cut anything that doesn't move it forward.

The video lasts until the last clip on any track ends. Music or a text clip that runs past the last shot leaves black frames at the end. Here the last shot ends at 28 seconds (frame 840) and the music runs to 31, so trim the music to the shot:

```json
{"op":"trim_clip","clipId":"c12","edge":"end","to":840}
```

Check the duration on the first line of `get_project` after big changes. If it's well past the length you aimed for, say so and offer what to cut.

## Safe areas

The apps draw over the video: the title and channel name, the description, the like and share buttons, the progress bar. The safe area is the box they leave clear. These are the defaults:

| Format | Kept clear | The box, as shares of the frame | In pixels |
|---|---|---|---|
| short_9x16 | Top 14%, bottom 35%, 6% each side | x 0.06–0.94, y 0.14–0.65 | 65 px each side, 269 top, 672 bottom |
| feed_4x5 | 5% each side | x 0.05–0.95, y 0.05–0.95 | 54 px each side, 68 top and bottom |
| square_1x1 | 5% each side | x 0.05–0.95, y 0.05–0.95 | 54 px all round |
| long_16x9 | 5% each side | x 0.05–0.95, y 0.05–0.95 | 96 px each side, 54 top and bottom |
| long_4k | 5% each side | x 0.05–0.95, y 0.05–0.95 | 192 px each side, 108 top and bottom |

- The 9:16 box follows Meta's published guidance for Reels and errs on the side of room at the top and bottom.
- Shorts and TikTok reach further in on the right. Shorts' buttons cover about the right 18% from 15% down, and TikTok's cover the right 28% between 44% and 66% down. For a video going to all three, keep text and faces in the lower half of the box centered and narrow, clear of the right side.
- x and y place a clip's center, so its edges need room as well. A two-line 96 px title in 9:16 is about 230 px tall, 0.12 of the frame, so its center belongs between y 0.20 and 0.59.
- Text wraps at 90% of the frame's width, a little wider than the 9:16 box. Keep lines short, or break them yourself with a new line.
- Captions sit low in the box by default: about y 0.56 in 9:16 and 0.79 in the other formats. Keep other text clear of them (see the on-screen-text topic).
- The box is for faces and products too. A face in the bottom third of a Short sits behind the description.
- In 16:9, YouTube's title bar and controls cover the top 12% and bottom 14% while the video is paused or hovered. Keep text people need to read out of those strips.
- Instagram's profile grid crops posts to 3:4. A 9:16 Reel loses about an eighth at the top and bottom, and a square post an eighth at each side.

People can see the box in the editor: they pick "Safe area" in the "View as" menu above the timeline. The same menu shows how Instagram Reels, YouTube Shorts, TikTok, the feeds and the profile grid cover or crop a frame of this shape, so suggest it when placement matters. If `get_project` shows a "Safe area" line, the project has its own size, and that box is the one to use.

**In EasyEdit.** Change the box only when the person asks: everyone in the project sees it. A new size keeps the format's top edge and grows down. A student council's TikToks carry long descriptions, so they want the box to stop 60% down the frame (0.14 + 0.46):

```json
{"op":"set_safe_area","format":"short_9x16","size":{"width":0.88,"height":0.46}}
```

Width and height run from 0.05 up; the height can be at most what's left below the top, 0.86 in 9:16 and 0.95 elsewhere. `"size":null` goes back to the default. After a change, move any text that now sits outside the box.

## Footage that isn't the frame's shape

Phone footage is usually upright and fills 9:16. Camera and screen footage is wide. With fit "cover", a wide clip fills a tall frame by cutting off its sides: in 9:16, a 16:9 clip shows only the middle third of itself. There are three ways to handle it.

**Slide it.** With fit "cover" and scale 1, a 16:9 clip is 3.16 frame-widths wide in 9:16 (2.22 in 4:5, 1.78 in 1:1). To center something that sits at a share p across the original picture, set x to 0.5 + (0.5 − p) × that width. A soccer club's wide shot has the goal at the left third (p 0.33): 0.5 + 0.17 × 3.16 ≈ 1.04.

```json
{"op":"update_clip","clipId":"c4","patch":{"transform":{"x":1.04}}}
```

Stay within 0.5 ± (width − 1) ÷ 2, which is −0.58 to 1.58 in 9:16, or an edge of the frame goes empty. A clip with x keyframes ignores its transform's x. You can't see where things are in the shot, so ask: "Is the action on the left, in the middle or on the right?"

**Follow the action.** When the subject moves across the shot, ask the person to select the clip and press "Reframe to follow the action" in its Reframe section in the editor. It finds the movement and adds x keyframes to keep it in view. It follows movement, not faces, and takes clips up to 9,000 frames long (five minutes at 30 fps); split a longer one first. It replaces the clip's x, y and scale keyframes, so reframe before you add a punch-in.

**Show all of it over a blurred copy.** Good for a band's wide stage shot or a slide deck. Keep the clip ("c1", with fit "cover") on "v1" as the background, and add an overlay track right above it (index 1, when "v1" is the first track):

```json
{"op":"add_track","track":{"kind":"overlay","name":"Sharp copy"},"index":1}
```

In your next call, use the track id the result gives (say "o1"). Put the same footage on that track with fit "contain" (same start, duration, in and speed), and blur, darken and silence the background so the sound doesn't play twice:

```json
[
  {"op":"add_clip","trackId":"o1","clip":{"type":"video","assetId":"a3","start":0,"duration":300,"in":0,"speed":1,"volume":1,"transform":{"x":0.5,"y":0.38,"scale":1,"rotation":0,"opacity":1,"fit":"contain"}}},
  {"op":"update_clip","clipId":"c1","patch":{"volume":0,"adjust":{"blur":40,"brightness":-0.25}}}
]
```

At y 0.38 the sharp copy runs from about 22% to 54% down the frame. Captions at their default y 0.56 land just under it, on the blur, and one line of hook text fits above it.

## Loops and the first frame

Shorts, Reels and TikTok play again from the top when they end. When the last frame flows into the first, people often watch twice before they notice.

- End on a moment that leads into the opening. A cooking creator opens on the knife coming down on a lemon and ends on the hand reaching for the next one. A band's clip ends on the drummer lifting the sticks and starts on the downbeat.
- Or end mid-sentence, so the opening finishes it: the last text reads "And that's why your bread is", and the first reads "Flat? Fix this step."
- Keep loops short, 7 to 15 seconds, and make every track end on the same frame.
- No fade to black, end card or "follow for more" slate. Take a fade off the last clip:

```json
{"op":"update_clip","clipId":"c9","patch":{"transitionOut":null}}
```

- Keep the music's fade at the end short, about 6 frames (0.2 seconds at 30 fps), so the seam doesn't sound like an ending:

```json
{"op":"update_clip","clipId":"c12","patch":{"fadeOut":6}}
```

You can't watch the seam. Ask the person to play the last two seconds into the first two and tell you if it jumps.

**The first frame.** Feeds show frame 0 while the video loads, and it's often the cover unless the person picks another frame when they post. Make it a finished picture with the hook already drawn: no `transitionIn` on the first clip, and no `animationIn` on text that's on screen at frame 0, since an animation starts it hidden, small or blank. Keep the hook in the middle of the frame, where the feed and grid crops leave it. The hooks topic has the details (`get_editing_guide` with topic "hooks").

On YouTube long-form, the person uploads a thumbnail, so a 10 to 15 frame fade in from black is fine there. They can make a thumbnail from the video: put the playhead on a good frame and use "Save frame as image" in the Export dialog. It saves that frame as a PNG at the size picked in the dialog. "Draft" gives 1280 × 720 from a 16:9 project, YouTube's thumbnail size, and usually keeps the file under YouTube's 2 MB limit.

## Long-form YouTube: pacing and chapters

- **The first 30 seconds:** say or show the payoff, then start delivering it (see the hooks topic).
- **Keep the picture changing.** In a talking video, a cut, b-roll, text or a punch-in every 5 to 15 seconds. Hold longer when something is being shown, like a step in a repair. The pacing topic has more.
- **Sections of 1 to 3 minutes,** each with one job. Open each with a short title, `add_text` with preset "lower-third" or "subtitle". If the style uses transitions, one dip can mark the change (see the transitions-and-motion topic).
- **Room at the end.** YouTube's end screen sits on the last 5 to 20 seconds. End on 10 to 20 seconds of a calm shot or a plain background with no text, so the person can place the end screen links in YouTube Studio.

**Chapters.** YouTube makes chapters from timestamps in the description. The first must be 0:00, there must be at least three, and each must run at least 10 seconds. Mark each chapter start with a marker: people see them on the timeline and the playhead snaps to them. Markers don't show in the video. `get_project` lists them on a "Markers:" line, so read it first and don't add one twice.

A bike shop's 8-minute repair video, at 30 fps:

```json
[
  {"op":"add_marker","marker":{"at":0,"name":"The wobble"}},
  {"op":"add_marker","marker":{"at":1350,"name":"Tools you need"}},
  {"op":"add_marker","marker":{"at":3900,"name":"Take the wheel off"}},
  {"op":"add_marker","marker":{"at":9900,"name":"True the wheel"}},
  {"op":"add_marker","marker":{"at":13800,"name":"Test ride"}}
]
```

Then give the person the lines for the description. Each time is the frame divided by the fps, written as minutes and seconds:

```text
0:00 The wobble
0:45 Tools you need
2:10 Take the wheel off
5:30 True the wheel
7:40 Test ride
```

Names can be up to 80 characters, and a project holds up to 200 markers. To change one, `update_marker` takes its markerId and a patch with a new name or at; `remove_marker` takes it out.

## Exporting is the person's step

You can't export, download or post, and you can't see the result. Never say you did. When the edit is done:

1. Say what you made and give the editor link.
2. Ask them to play it through once with sound, and to check frame 0 and the end.
3. Tell them to press Export in the editor's top bar. The export runs in their browser.

What to pick in the Export dialog:

- **Format:** MP4 video, for every platform here.
- **Size:** "Same as project". A long_4k project can use "1080p" for a quicker upload, and "Draft" makes a small file to share for feedback.
- **Quality:** "Standard" for most videos, "High" for the final upload of fast motion or fine detail, "Smaller file" for drafts.
- **Full quality,** when the dialog offers it, draws each video from its original file instead of the smaller copy the editor plays. It's slower, so suggest it for the final version.
- **What to export,** when it's offered: "Whole project" as a rule. "Selected clips" or "From the playhead" makes a quick cut-down, like a teaser from a long video.

Then they upload it in the app. Remind them what goes there and not in the video: the title, the description with the chapter timestamps, and the cover or thumbnail.

## Common mistakes

- Making a 16:9 project for a Reel, or a 9:16 one for a long YouTube video. Ask where it's going before you build.
- Putting text or a face in the bottom 35% of a Short, behind the description and buttons, or running text into the right side, under the Shorts and TikTok buttons.
- Running `set_format` and not checking the text, the captions' y and size, and the wide shots after.
- Showing only the empty middle of a wide shot in 9:16. Slide it, reframe it, or put it over a blurred copy.
- Music or text that runs past the last shot, so the video ends on black frames.
- Ending a loop on a fade to black, an end card or "thanks for watching".
- Chapter timestamps that don't start at 0:00, or chapters shorter than 10 seconds.
- Saying the video is exported or posted. Give the editor link and the export steps instead.
