# Before you hand it back

Read this when the edit is done and you're about to hand it back: a last pass over the opening, gaps, text, captions, sound, ending and style, and what to tell the person.

## The short version

- Read the project fresh with `get_project`, every page, before you say it's done. Someone may have changed it while you worked, and what you remember building is not the project.
- Check the first second: a picture and the hook text at frame 0, both fully drawn, and the text up for at least 1.5 s (45 frames at 30 fps).
- Walk the main video track from frame 0 to the end. Each clip starts on the frame the one before it ends. Any gap is a black flash.
- Check every text clip against the safe area using its size, not just its center. Leave it up a second for every 3 words, and never less than 1.5 s.
- Every talking clip shows captions=on, and the lines read right: names and numbers spelled the way the person spells them.
- Voice at 1 (or where Level volume put it), music 0.15 to 0.25 under it, nothing playing twice, and nothing running past the last picture.
- Compare the project with the space's style, field by field, and the always and never lists line by line.
- Then tell the person what changed in plain words, what you couldn't check, and give them the editor link.

Numbers here assume 30 fps. Read the project's fps from the Format line at the top of `get_project` and multiply: 1.5 s is 45 frames at 30 fps, 36 at 24 and 90 at 60.

## Read it fresh, then fix in small batches

Start the check from a new read, not from memory.

- Call `get_project`. If the last line says there are more lines, call it again with the cursor and version it names until you've read every page.
- Compare the version with your last edit result. If it moved, someone else changed the project. Read what they did and keep it. Don't "fix" their work back to yours.
- Note the Format line: format, fps and duration. The duration is in seconds and is the end of the last clip on any track, so it's also where the video ends.
- Look for a "Safe area" line. If there is one, that box replaces the defaults below.
- Look at each track's flags, like `Track v2 [overlay] "B-roll" (hidden, muted)`. A hidden track draws nothing, and its videos make no sound. A muted one makes no sound. Make sure each flag is there on purpose.
- A locked track refuses changes. Ask before you unlock one: people lock tracks to keep them as they are.

List everything that's wrong before you change anything. Then fix it in a few small batches, one per kind of fix: gaps, text, captions, sound. Each batch is one line in the editor's Activity list, so the person can undo one fix and keep the rest. A batch is applied whole or not at all, so one bad op holds back the whole batch. Each result gives a new version: pass it as expected_version for the next batch.

## The first second and the last

The hooks topic covers how to open well. Here you're checking that the opening and the ending survived the edit.

The first second:

- The main video track has a clip starting at frame 0. After clips are removed or moved, the first one can end up at frame 12 with black before it.
- That clip has no transition in. In `get_project` a transition shows as `in=<kind> <seconds>`, like `in=fade 0.50s` or `in=slide-left 0.40s`. The plain `in=2.40s` right after the asset is where the footage starts, not a transition. Every transition in starts the first clip on black (or a dip's color), and feeds show frame 0 while the video loads.
- The first text starts at frame 0 too. Its anim-in, if it has one, is "scale_punch". "fade", "pop" and the slides start see-through, and "typewriter" starts with almost nothing typed.
- Neither starts at opacity 0. Look for `kf.opacity=0:0`.
- The hook text stays up at least 45 frames, and something changes by about second 3: a new shot, a new line or a zoom.

Take the fade off a first clip and the animation off a first text:

```json
[
  {"op":"update_clip","clipId":"c1","patch":{"transitionIn":null}},
  {"op":"update_clip","clipId":"c5","patch":{"animationIn":null}}
]
```

The last second:

- The last picture is the last thing. The duration on the Format line, times the fps, should equal the end frame of the last clip on the main video track. If music, a voice clip or text runs past it, the end plays over black.
- The final shot holds 1 to 2 s (30 to 60 frames): the finished cake, the final score, the end card.
- The speaker finishes. If the last caption line ends on the video's very last frame, the last word may be cut off. Ask, or lengthen the clip if its footage allows.
- The music ends with the picture, with a fade out or with the song's own ending (see the music-and-sound topic).
- If the style asks for a closing line ("always end with the shop's hours"), it's there, inside the safe area, for at least 1.5 s.
- A Short plays on a loop. A clean cut on the last frame flows back into the hook better than a fade to black, unless the style uses one.

A study channel's last shot ends at frame 1350 (45 s). The music c12 runs to 1500 and the "Subscribe for part 2" text c9 to 1410. Trim both back to the last picture and fade the music over the last 1.5 s:

```json
[
  {"op":"trim_clip","clipId":"c12","edge":"end","to":1350},
  {"op":"update_clip","clipId":"c12","patch":{"fadeOut":45}},
  {"op":"trim_clip","clipId":"c9","edge":"end","to":1350}
]
```

## No gaps, no black frames

Behind every track the frame is black. Wherever nothing is drawn, people see black.

Walk the main video track: the first track of kind video, usually v1. `get_project` gives each clip's frames, like `frames 0–84`. The first starts at 0, and each one starts on the frame the one before it ends: 0–84, 84–150, 150–212. A clip that starts at 152 instead leaves a 2-frame black flash. Slivers of one or two frames are common when clips were placed in seconds and the times rounded.

Other ways black gets in:

- A hidden track that holds the only picture at some moment.
- fit "contain" on footage of another shape. A 16:9 clip in a 9:16 project shows black bars above and below. Use "cover" unless the person wants the whole picture.
- A scale below 1, a crop, or x and y moved off center, with nothing under the clip.
- opacity below 1 with nothing under it, or opacity keyframes that dip to 0.
- A fade out on one clip and a fade in on the next, or a dip, in the middle of the video. That can be a choice. In a quick Short it reads as a blink, so keep only the ones you or the person picked.

Gaps on overlay tracks are fine. B-roll over the main track is meant to come and go.

Close a small gap by stretching a clip over it, so nothing else moves. A soccer club's recap has c3 ending at frame 268 and c4 starting at 270. Pull c4's start back 2 frames:

```json
{"op":"trim_clip","clipId":"c4","edge":"start","to":268}
```

That shows 2 more frames of c4's footage, from just before its in, so it works when its in is 2 frames or more. If the trim is refused because the footage runs out, trim c3's end out to 270 instead. Only when a gap is longer than a few frames should you move the clips after it, and then move the text, b-roll and music that go with them by the same amount. Captions follow their clips on their own.

You can't see the frames. Tell the person where you closed gaps, and ask them to play it through once.

## Text and captions

For each text clip, `get_project` gives its text, size, x and y. Check four things.

**Inside the safe area.** By default, 9:16 keeps text between y 0.14 and 0.65 and between x 0.06 and 0.94. Other formats keep 5% clear on every side, so 0.05 to 0.95 both ways. y is the text's center, so leave room for half its height:

- A line is about 1.2 times the font size tall. In a 1920-pixel-tall frame, a 96 px line is 115 px, 0.06 of the height. Two lines are 0.12.
- So a two-line 96 px title needs y between about 0.2 and 0.59 in 9:16. A scale of 1.2 makes it 1.2 times as tall, and a box behind it (backgroundPadding) adds more.
- Long lines wrap at 90% of the frame's width, and the 9:16 safe area is 88% wide. If a line fills the width, shorten it, put a line break in the text, or bring the size down.
- The apps cover more than that box in places. TikTok covers the left and right 11%, and the right 28% from y 0.44 to 0.66. YouTube Shorts covers the top 15% and the right 18%. For a Short, keep a centered line between x 0.18 and 0.82 (64% of the width), and its right edge left of x 0.72 if it sits between y 0.44 and 0.66.

**Off the captions.** In 9:16, captions sit at y 0.558 by default. The "Captions:" line gives the project's own y. While caption lines show, keep other text at least 0.15 of the frame's height from that y (0.25 in 16:9 and 4K). In a Short, about y 0.3 works.

**Up long enough.** A second for every 3 words, never under 1.5 s (45 frames). "Tickets on sale Friday at lunch" is six words, so 2 s, or 60 frames. A clip is up for its end frame minus its start frame.

**Ends with its shot.** Text that belongs to a shot should end on that shot's last frame. Ending 3 frames into the next shot looks like a flicker.

A student council's "Vote Thursday in the gym" (c6, frames 360–400) sits at y 0.62, just below the captions, and is up for only 40 frames. Move it up and give it 60:

```json
[
  {"op":"update_clip","clipId":"c6","patch":{"transform":{"y":0.3}}},
  {"op":"trim_clip","clipId":"c6","edge":"end","to":420}
]
```

Clips can't overlap on a track, so if the next text on that track starts before frame 420, the trim is refused. Move or shorten the next one first.

Then the captions:

- Every clip where someone talks shows captions=on. Clips added late are the ones that get missed.
- Never twice. If a video's sound was split off onto an audio clip, only one of the pair has captions on. Captions still show on muted or hidden tracks and at volume 0.
- The Captions track isn't hidden, unless the person wants subtitles only as a file.
- The "Captions:" line shows one look for the whole project. In 9:16 its y is between 0.2 and 0.6. Lines wrap at 80% of the width (90% for bar), so a size well above the default (about 70 in a 1080-wide frame), or all caps, can push a line to three rows.
- Read every caption line. Fix misheard names, brand names and numbers with `splice_caption_words`, highest index first, so one fix doesn't shift the places of the next. Keep the person's own words. If you can't tell what was said, ask.
- If a talking clip's file has no saved words yet, you can't turn its captions on. Name the clip, and ask the person to press Auto captions in the editor's Captions tab.

The student council video: c7 talks but has no captions, and the line `"Hi I'm Maya from student counsel"  clip=c2 asset="a3" words=0-5` misheard place 5. One batch fixes both:

```json
[
  {"op":"update_clip","clipId":"c7","patch":{"captions":true}},
  {"op":"splice_caption_words","assetId":"a3","index":5,"remove":1,"text":"council"}
]
```

## Levels

You can't hear the mix. Check the numbers, then ask the person to listen once.

- Voice clips at vol=1, or where the editor's Level volume button set them.
- Music under a voice at 0.15 to 0.25. Music on its own at 0.6 to 1.
- Nothing above 1, unless Level volume set it or the footage was recorded too quietly. Past full scale it distorts.
- A video whose sound was split off has vol=0, or the sound plays twice and sounds hollow.
- A clip with kf.volume ignores its vol. To change its level, edit the keyframes.
- Music fades in over about 15 frames, unless it starts right on the hook, and out over 30 to 60 at the end. Voice clips cut from a longer take get a 2- or 3-frame fade at each end, so the cuts don't click.
- `get_project` doesn't list a track's volume. If you set one, say what you set.

A cooking creator's music c8 sits at vol=0.6 under a voice the whole way, with no fades:

```json
{"op":"update_clip","clipId":"c8","patch":{"volume":0.2,"fadeIn":15,"fadeOut":45}}
```

Then ask them to play it with the audio meter open (Shift+M in the editor) and tell you if the voice is easy to follow.

## Follow the space's style

Have the style in front of you: `get_editing_guide` with the project's space. `list_projects` names each project's space, and its Spaces line gives the slug to pass (or "personal"). If the guide ends with "## This space's style", check the project against each field it has.

| Field | What to check in `get_project` |
|---|---|
| formats | The Format line's format is one of them. |
| lengthSeconds | The duration is between min and max. |
| pace, shotSeconds | The video's length divided by its shots: the main track's clips, plus b-roll cut in over them. 30 s with 16 shots is about 1.9 s a shot. Rapid is under 1.2 s, quick under 2.5, steady 2.5 to 4, calm over 4. |
| hook | The opening does what it says, in their words. |
| captions | on: captions=on on every talking clip (or none, if on is false). look, uppercase and position match the "Captions:" line. Position as y, from the table in the captions topic: on short_9x16 upper 0.25, middle 0.45, lower 0.558; on the other formats upper 0.2, middle 0.5, lower 0.788. |
| text | none: no text clips beyond what the person asked for. light: a few lines. lots: text through most of the video. |
| music | none: no music clip. soft: quiet, at the low end of the levels above. upbeat or intense: go by the song's name, and ask if you're unsure. |
| transitions, transitionKinds | Count the in= and out= transitions. cuts: none, or almost none. few: a handful, at big moments. lots: most cuts. Every kind used is in transitionKinds. |
| look | natural: no adjust= or grade= on the video clips or an adjustment layer, beyond fixes the person asked for. A look id: the look is in one place, never two. Either one adjustment layer over the whole video has that look's numbers, at any amount, or each video clip's adjust= has them (the color-and-looks topic lists them). When a layer covers the clips, leave their adjust alone: the look on both comes out twice as strong. If neither has it, add the layer as the color-and-looks topic shows, or ask. |
| voice | Text you wrote sounds like them. |
| always, never | Go line by line. "Never open on our logo" and "always end with the shop's hours" are easy to break by accident. |

Read the notes too. If you broke a rule on purpose because the person asked, say so when you hand it back.

With no style saved, say which defaults you used. If the person tells you something that should stick, offer to save it with `save_style`. Saving needs an editor or admin and changes what every agent in the space reads, so ask first. People can also change it under Settings → Style.

## Hand it back

After the last fix, read the project once more. Check the version is the one your last edit made and every fix landed. Then write to the person:

- Start with the editor link and one line on what it is. `create_project`'s answer has the link, `search` results carry it as url, and `list_projects` names the pattern: the site's /editor/ followed by the project id.
- Say what changed in plain words, with times in seconds. "Closed two tiny black flashes at 0:09 and 0:17", not "trimmed c4".
- Name what you chose that they might want different, one line each.
- Say what you couldn't check. You can't watch or listen. Ask them to play it once with sound, look at the first frame, and pick a View as option in the preview (TikTok, Instagram Reels or YouTube Shorts) to see what the app's buttons cover.
- Say what's left for them: Auto captions for a clip with no words yet, Level volume, picking the song, exporting. You can't export or post yet.
- Tell them every change is a line in the Activity list, so any one of them can be undone.

A bike shop's Reel, handed back:

> Your 31-second Reel for Wobbly Wheel Bikes is ready: (editor link)
>
> - It opens on the trued wheel spinning, with "Bent wheel? Fixed in a day" at the top.
> - I closed two tiny black flashes, at 0:09 and 0:17, and trimmed the music to end with the last shot, fading over the final 1.5 seconds.
> - Captions are on for all four talking clips. I fixed "through" to "true" in two places.
> - The music sits low (20%) under your voice and comes up to 70% over the last shot.
> - It follows your style: karaoke captions in caps, straight cuts, under 35 seconds.
> - I can't watch or listen. Could you play it once with sound, and try View as: TikTok to check nothing sits under the buttons?
>
> Each change is a line in the Activity list if you want one back.

## Common mistakes

- Saying it's done without reading the project again, or after reading only the first page.
- Closing a gap by moving one clip, which opens a new gap after it and pulls its text and music out of step.
- Checking a text clip's y but not its size, so a two-line title at y 0.16 runs past the top of the safe area.
- Captions on both a video clip and its split-off sound, so every line shows twice.
- Music or text running past the last picture, so the video ends on black.
- Saying it "looks great" or "sounds balanced". You checked numbers, not pictures or sound. Say that, and ask them to watch.
- A handback full of op names and clip ids instead of what changed in the video.
- Breaking a style rule without saying so, or "fixing" something the person chose on purpose.
