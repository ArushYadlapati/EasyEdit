# Pace and cuts

Read this when you choose how long shots run, tighten a talking video, cut on action or a beat, make J and L cuts, or match the pace a space's style asks for.

## The short version

- Pick a pace before you cut: calm, steady, quick or rapid. The space's style may name one. If not, choose one from the kind of video and tell the person which you chose.
- Ops take whole frames at the project's fps, which is on the first line of `get_project`. At 30 fps, 1 s is 30 frames and 0.5 s is 15. Never assume 30.
- Cut a shot once it has shown its one thing. In most Shorts and Reels that takes 1.2 to 2.5 s (36 to 75 frames at 30 fps).
- Vary the lengths. Hold the payoff shot about twice as long as the shots around it.
- Cut on action: end a shot partway through a movement and pick the movement up in the next shot.
- Take out dead air. Start a talking clip just before the first word, end it a few frames after the last, and cut pauses of 0.6 s or more, leaving about 0.12 s of breath on each side.
- A ripple only closes the gap on its own track. Move the text and b-roll that came after a cut, trim the music to the new end, and cut a video's linked sound along with it.
- For J and L cuts, separate the sound first. Then trim the audio clips and leave the pictures alone.

## Pick a pace

A pace is how long a shot usually lasts. A space's style uses these four:

| Pace | A shot lasts | At 30 fps | Suits |
|---|---|---|---|
| calm | over 4 s | over 120 frames | a study explainer, a slow shop tour, a long sit-down interview |
| steady | 2.5 to 4 s | 75 to 120 frames | a recipe or repair how-to, a talking head with some b-roll |
| quick | 1.2 to 2.5 s | 36 to 75 frames | most Shorts and Reels, an event recap, a highlight reel |
| rapid | under 1.2 s | under 36 frames | a montage on the beat, a ten-second teaser |

Where to find it:

- Call `get_editing_guide` with the project's space. If the space has a style, the guide ends with "## This space's style". Look for pace and shotSeconds, the typical shot length. Treat shotSeconds as the middle and let shots vary by about a third either way. A shotSeconds of 1.8 means most shots run 1.2 to 2.4 s.
- Each analyzed reference video lists its shots: how many, the average and median shot length, and shots a minute. Go by the median, because one long intro shot pulls the average up. Shots a minute works too: 40 a minute is about 1.5 s a shot.
- If a reference talks, look at words a minute and how much of it is talking. In a reference that's mostly talking, about 140 to 160 words a minute is relaxed speech with the pauses left in. At 180 and up, the pauses were usually cut out. When it's mostly talking, the voice sets the rhythm. When it's mostly pictures, the shots do.
- Past projects in the style list their length and shots too. A space whose projects always cut quick wants quick, unless the person says otherwise.
- No style? Go by the kind of video. A cooking creator's recipe usually wants steady, a soccer club's highlight reel quick, a band's teaser rapid. Tell them in one line which pace you picked, so it's easy to change.
- If the person asks for "faster" or "slower", move one step. If they want that to stick and they're an editor or admin of the space, offer to save it with `save_style` (their space, and fields pace and shotSeconds). Ask before you save. People can also change it themselves under Settings → Style.

## Choose each shot's length

A shot should stay up long enough to be understood, and no longer.

- A close, simple shot reads in about 1 s: a hand, a face, a logo on a cup. A wide, busy shot needs 2 to 3 s: a whole team on the field, a crowded shop floor.
- Text needs reading time, about 3 words a second and never under 1.5 s, but it can run across cuts. Let a title sit over two or three quick shots instead of slowing every shot down. See `get_editing_guide` with topic "on-screen-text".
- Open a little faster than the rest. In the first 5 s of a Short, change something every 1.5 to 3 s. The "hooks" topic has more.
- Aim for a rhythm, not a metronome. Mix lengths around your pace. Let the shots get shorter as you build toward the best moment, then hold that moment.
- Give the last shot a little extra time so the ending doesn't feel cut off. A video made to loop is different (see `get_editing_guide` with topic "platforms").
- Count before you chop. The number of shots is the length divided by the shot length. A 30 s Reel at 1.8 s a shot is about 17 shots. If you only have six clips, don't slice them into 1 s scraps to hit that number. Pick a steadier pace, or use different moments of the same clip.

Example: an 18 s quick Reel for Puddle Lane Bakery, ten shots. 1.5, 1.8, 1.6, 1.4, 1.2, 1.1, 2.6 (the croissant pulled apart, the payoff), 1.4, 2.0, 3.4 (the shop front and the name). The shots tighten toward the payoff, then it holds. The median is 1.55 s, well inside quick. At 30 fps that's 45, 54, 48, 42, 36, 33, 78, 42, 60 and 102 frames, 540 in all. Round each length to a whole frame.

In EasyEdit:

- Lay down a first cut with `add_media`. Give each item in_seconds (where in the footage it starts) and duration_seconds. Items without start_seconds go end to end.
- Phone clips often start and end with a wobble from pressing record. Start at least 0.5 s in, and stop 0.5 s before the end.
- If one long video holds many shots, ask the person to press Split at scene changes in the clip's Scenes section. Each shot becomes its own clip that you can trim.
- Fine-tune in frames with `trim_clip`. A trim moves nothing else, so close the gap yourself by moving the later clips left, earliest first. Here shot c2 (frames 60–150) loses 1 s at 30 fps, and c3 (150–210) and c4 (210–300) move up:

```json
[
  {"op":"trim_clip","clipId":"c2","edge":"end","to":120},
  {"op":"move_clip","clipId":"c3","start":120},
  {"op":"move_clip","clipId":"c4","start":180}
]
```

- When many clips follow, split the shot where it should end and remove the tail with ripple instead, as in "Trim dead air" below. That moves everything after it on the track in one op.
- A trim with edge "start" drops footage from the head and keeps the end where it was. Follow it with a `move_clip` back to where the clip began, then move the later clips up.
- If a slow movement runs long, you can speed it up instead of cutting it. `update_clip` with speed keeps the clip's length and plays more footage, so shorten the clip first. Here shot c5 (frames 270–390, speed 1) fits the same 4 s of footage into 2 s:

```json
[
  {"op":"trim_clip","clipId":"c5","edge":"end","to":330},
  {"op":"update_clip","clipId":"c5","patch":{"speed":2}}
]
```

Then move the later clips up by 60 frames. Speed works best on b-roll: a pour, a walk, a crowd filing in. Sound keeps its pitch, but a voice at 2× is hard to follow.

## Cut on action and on the beat

When a movement carries across two shots, cut partway through it. The eye follows the motion across the cut and hardly notices the cut itself.

- A cooking creator lifts a lid in the wide shot. Cut to the close-up while the lid is still rising.
- A player swings to shoot. Cut as the foot meets the ball, to the angle from behind the goal.
- A guitarist raises an arm for the last chord. Cut on the strum.
- Let the next shot repeat 2 or 3 frames of the movement. A cut that matches to the exact frame can look like a skip.

You can't see the footage, so you can't find the exact frame yourself. Place the cut where the file names, events and the person's notes point. Then tell them which cuts to check, and ask about a moment when it matters ("When does the lid come off in clip 3?").

Cutting to music:

- You can't hear the music either. Ask for the tempo in beats a minute (BPM) and where the first beat lands, or ask them to press B on the beats while it plays. That drops a marker at the playhead, and `get_project` lists every marker with its time on a Markers line.
- A beat lasts 60 ÷ BPM seconds. At 120 BPM that's 0.5 s, or 15 frames at 30 fps. At that tempo, a cut every 2 beats (1 s) is rapid, every 4 beats (2 s) is quick, and every 8 beats (4 s) is steady.
- Count every cut from the first beat. Don't keep adding a rounded beat, because the cuts drift. The beat math is in `get_editing_guide` with topic "music-and-sound".
- Not every cut needs a beat. Cutting on every beat for 20 s gets tiring, so let a shot run across a bar now and then.
- Over a voice, change the b-roll where a caption line starts. Lines break at sentence ends and at pauses, so the picture changes along with the words.

## Trim dead air and pauses

Dead air is any stretch where nothing is said and nothing happens: the breath before the first word, "okay, is it recording?", a long pause while someone thinks. In a quick video, it's the first thing to go.

When captions are on, `get_project` lists the caption lines with their times, so you can see where the talking is. Each line:

- starts on its first word,
- stays up 0.4 s after its last word, unless the next line starts sooner,
- and gives way to a new line after any pause longer than 0.6 s, at the end of a sentence, or when it's full.

So when the next line starts later than this one ends, there's a pause. The silence runs from 0.4 s before this line's end to the start of the next line.

The easiest way is the editor. Ask the person to open the Captions tab, switch Lines to Cut video, and press Cut pauses or Cut filler words. Cut pauses takes out every silence of 0.6 s or more and leaves a breath on each side. Cut filler words takes out the ums and uhs. They can also pick words and press Cut words. Cut pauses and Cut filler words work on the selected clips, or on every captioned clip when no captioned clip is selected. Each is a single change with a single undo, and the editor says how much shorter the video got. It closes the gap on that clip's track only, so read the project afterwards and fix the other tracks as below. These need captions. Turn them on with `update_clip` (patch captions true) if the file already has saved captions. If not, ask the person to press Auto captions first.

To cut a pause yourself, here's an example from a study channel. Clip c1 on track v1 runs 0–20 s at 30 fps, with captions on. Two of its lines:

- 3.00–4.50s "So here's the trick"
- 5.70–7.20s "write it out by hand"

The first line's last word ends at about 4.10 s (4.50 minus the 0.4 s hold), which is frame 123. The next line starts at 5.70 s, frame 171. That's 1.6 s of silence. Keep 4 frames (about 0.12 s) on each side and take out frames 127 to 167.

First call: split at the later frame first, so c1 keeps the start each time.

```json
[
  {"op":"split_clip","clipId":"c1","at":167},
  {"op":"split_clip","clipId":"c1","at":127}
]
```

The result lists the new clips. The second half from the split at 127 is the pause (frames 127–167). Second call: remove it with ripple, so the rest of the track moves up. Here c8 stands for the id the result gave you.

```json
{"op":"remove_clip","clipId":"c8","ripple":true}
```

Several pauses work the same way. Make one call with every split, latest first, then one call that removes every pause piece.

After a cut:

- The captions follow their clip. Never move them yourself.
- Ripple only moves that one track. Text and b-roll that came after the cut now sit 40 frames late, so move them left by the same amount. A clip that spans the cut needs trimming instead. Leave a music bed where it is and trim its end to the video's new end.
- If the clip's sound sits on a linked audio clip (`get_project` shows the same group= on both), make the same splits and removals on that clip in the same calls. Otherwise the voice slips out of sync.
- A cut inside one continuous shot is a jump cut: the face jumps a little. Quick Shorts often keep them as rhythm. To soften one, punch in on the piece after it, or cover it with b-roll (see the "b-roll" topic). Here c7 stands for the id the split at 167 gave you:

```json
{"op":"update_clip","clipId":"c7","patch":{"transform":{"scale":1.12}}}
```

How much to cut:

- Quick and rapid: cut every pause of 0.6 s or more.
- Steady: cut pauses over about 1 s and leave the shorter ones.
- Calm: leave most pauses in, because a study video needs room to think. Cut the false starts and the long waits.
- Start a talking clip 2 or 3 frames before its first word, so the first sound isn't clipped.
- End a talking clip 4 to 6 frames after its last word. That's about 6 to 8 frames before the line's end time at 30 fps.

## Long videos

A long YouTube video (long_16x9 or long_4k, several minutes) usually runs steady or calm overall, but it still has to keep moving.

- Keep the picture changing. In a talking video, add a cut, a b-roll shot, text or a punch-in every 5 to 15 s. Hold longer while something is being shown, like a step in a repair.
- Change pace by section. Run the intro and any recap quicker, then settle into the main part.
- Cut pauses over about 1 s and every false start, but leave a beat after a key point so it lands.

## J and L cuts

In a plain cut, the picture and the sound change on the same frame. Splitting them apart makes a cut feel smoother.

- J cut: you hear the next shot before you see it. The Riverside Otters' coach finishes a sentence, and the whistle and shouts of the warm-up come in half a second before the picture cuts to the warm-up. This works well for moving into a new scene.
- L cut: the picture moves on while the sound stays. The coach keeps talking for half a second over the first shot of the warm-up. This works well for showing what someone is talking about.

Most J and L cuts run 0.3 to 1 s, which is 9 to 30 frames at 30 fps.

First, separate the sound. In the editor, that's Separate audio (Shift+S), in a video clip's Sound section or its right-click menu. It links the video with its new audio clip. To do it with ops:

- Add an audio clip of the same asset on an audio track with room at those times, with the same start, duration, in and speed.
- Give the video and the audio clip one group name: the video's own group if it has one, or else a name the project doesn't use yet.
- Copy the video's volume and fades to the audio clip, then set the video's volume to 0.
- If the video shows captions=on, move the captions too: add the audio clip with "captions": true, and set the video's captions to false in the same batch.

Here the coach shot c1 (frames 0–300) and the warm-up shot c2 (frames 300–540, starting 2 s into its footage) get their sound on audio track a1, the one a new project starts with:

```json
[
  {"op":"add_clip","trackId":"a1","clip":{"type":"audio","assetId":"asset1","start":0,"duration":300,"in":0,"speed":1,"volume":1,"group":"coach","transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"cover"}}},
  {"op":"add_clip","trackId":"a1","clip":{"type":"audio","assetId":"asset2","start":300,"duration":240,"in":60,"speed":1,"volume":1,"group":"warmup","transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"cover"}}},
  {"op":"update_clip","clipId":"c1","patch":{"volume":0,"group":"coach"}},
  {"op":"update_clip","clipId":"c2","patch":{"volume":0,"group":"warmup"}}
]
```

The result names the two new audio clips. Call them s1 and s2. Now the J cut, 15 frames long: the warm-up sound starts at frame 285, the picture still cuts at 300, and a 2-frame fade on each side keeps the sound cut from clicking.

```json
[
  {"op":"trim_clip","clipId":"s1","edge":"end","to":285},
  {"op":"trim_clip","clipId":"s2","edge":"start","to":285},
  {"op":"update_clip","clipId":"s1","patch":{"fadeOut":2}},
  {"op":"update_clip","clipId":"s2","patch":{"fadeIn":2}}
]
```

Or the L cut: the coach's voice runs on to frame 315.

```json
[
  {"op":"trim_clip","clipId":"s2","edge":"start","to":315},
  {"op":"trim_clip","clipId":"s1","edge":"end","to":315}
]
```

Things to know:

- Order matters. Clips on a track can never overlap, not even between two ops in one batch. Shorten one clip before you lengthen its neighbor.
- Both sounds share one track, so the one you shorten loses its tail or head. For the J cut, the coach must be done talking by frame 285. Check the caption lines first. To keep the coach's last words under the warm-up sound, put s2 on a second audio track instead.
- Lengthening a clip needs footage. The J cut needs 15 frames before s2's in point, and it starts 60 frames in, so that works. The L cut needs the coach's footage to run at least 315 frames.
- Linked clips only move together in the editor. Each of your ops touches one clip, so when you move a shot, move its sound by the same frames in the same batch.
- People can fine-tune the sound cut themselves with the trim mode button beside Snap. Pressing it, or W, steps through the modes. Roll moves the cut between two clips that touch. Alt-click picks one clip of a linked pair on its own.

## Common mistakes

- Assuming 30 fps. In a 24 fps project, a 30-frame shot lasts 1.25 s. Read the fps from `get_project` first.
- Ripple-cutting the talking clip and leaving the titles and b-roll where they were, so they now land late.
- Cutting a video but not its linked audio clip, so the voice slips out of sync.
- Using `splice_caption_words` with empty text to "cut" a word. That only changes the captions. The word can still be heard.
- Giving every shot the same length. Even when every shot is good, matching lengths feel mechanical.
- Lengthening one clip in a J or L cut before shortening its neighbor, so the batch is refused for overlapping.
- Making a J cut that clips the end of someone's sentence, because their sound clip got shorter.
- Cutting every pause out of a calm explainer until it sounds breathless. Match the style's pace, not the fastest one.
- Trimming past the end of the footage. Check the asset's length in `list_assets` first, because a trim like that is refused.
