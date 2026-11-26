# B-roll and cutaways

Read this when you lay other footage over someone talking: to hide jump cuts, show what they describe, build picture-in-picture, or use stock clips.

## The short version

- Put b-roll on its own overlay track just above the main video. The talking clip stays whole underneath, so the voice keeps running.
- Add that track with an `index` right after the main video track. Without one it lands on top of your titles and captions.
- Silence the b-roll's own sound: mute its track, or set each clip's `volume` to 0 (0.1 to 0.25 when its natural sound helps).
- To hide a jump cut, start the b-roll 10 to 15 frames before the cut and end it at least 30 frames after.
- To show what is said, read the caption lines in `get_project` and start the shot on the line that names the thing.
- Hold each shot 1.5 to 3 seconds in a short (45 to 90 frames at 30 fps) and 2 to 5 seconds in long-form, or what the space's style gives. Come back to the face for the hook, the main point and the ending.
- For picture-in-picture, set `fit` to "contain" and `scale` to 0.3 to 0.5, and keep the whole box inside the safe area.
- You can't watch footage. Go by names, events, lengths and caption lines, and ask when the right shot isn't clear.

## How the layers work

`get_project` lists tracks in drawing order. The first one is the bottom layer, and each later track draws on top. A new project starts with `v1` (Video 1), `t1` (Text 1) and `a1` (Audio 1). The talking clip, the A-roll, usually sits on `v1`.

B-roll goes on an overlay track between the main video and the text. An `add_track` with no `index` goes to the end of the list, which is the top layer, so your b-roll would cover titles and captions. Count the tracks in `get_project` and pass the index right after the main video track:

```json
{"op":"add_track","track":{"kind":"overlay","name":"B-roll"},"index":1}
```

The result gives the new track's id. Use it in your next call. The examples below call it `o1`. If the project already has an overlay track for b-roll, reuse it instead of adding another.

To place shots, `add_media` is the easy way: give `asset_id`, `start_seconds`, `in_seconds` (where in the footage to begin), `duration_seconds` and `track_id`. Its clips come in at full volume. If the track you name is busy at that time, it puts the clip on another track or makes a new one, so check the result. To work in frames, or to set the volume in the same step, use `add_clip`. This one puts 2.5 seconds of footage, starting 2 seconds into the file, at 5 seconds on the timeline:

```json
{"op":"add_clip","trackId":"o1","clip":{"type":"video","assetId":"A","start":150,"duration":75,"in":60,"speed":1,"volume":0,"transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"cover"}}}
```

The examples here use 30 fps. Read the project's fps on the first line of `get_project` and multiply seconds by it. `list_assets` always counts frames at 30 fps, so on a 24 or 60 fps project, work from its seconds.

Phone clips often shake for the first half second while the camera settles, and again at the end when someone reaches for the button. Start `in` about 15 frames (at 30 fps) into the file, and stop short of its end. `in` + `duration` × `speed` must stay inside the file's length.

Put one set of b-roll shots in one `edit_timeline` batch. It shows up as one line in the editor's Activity list, so the person can undo all of it at once if they don't like it.

## Keep the voice running

B-roll covers the picture, not the sound. The talking clip on `v1` keeps playing under it: picture hidden, voice heard. That only works if you leave that clip alone.

- Don't split the talking clip and drop b-roll into a gap on the same track. The voice goes out with the picture you removed.
- Don't hide the main video track. A hidden track loses its sound too.

The b-roll's own sound is the other trap. A kitchen clip has fan hum, a match clip has whistles and shouting, and at full volume they fight the voice. Mute the b-roll track. A muted track still draws its pictures. It just makes no sound:

```json
{"op":"update_track","trackId":"o1","patch":{"muted":true}}
```

When a shot's sound adds something, like bread crackling as it cools or a crowd cheering a goal, keep it but low, and fade it so it doesn't pop in:

```json
{"op":"update_clip","clipId":"c7","patch":{"volume":0.2,"fadeIn":6,"fadeOut":6}}
```

A track has its own `volume` too, on top of each clip's. This turns the whole b-roll track down in one step:

```json
{"op":"update_track","trackId":"o1","patch":{"volume":0.2}}
```

`list_assets` marks each video "with sound" or "no sound". A "no sound" shot has nothing to mute. Mute or turn down only the tracks whose sound you don't need. In picture-in-picture, the speaker may be the clip on the overlay track (see below).

## Cover jump cuts

When you cut a pause or a false start out of a talking clip (split it at both ends of the bad part, then `remove_clip` with `ripple`), the head jumps from one spot to another. One b-roll shot over the cut hides it. The cutting itself is in the pacing topic (`get_editing_guide` with topic "pacing").

- Start the shot 10 to 15 frames (about 0.3 to 0.5 seconds) before the cut, so it is already up when the jump happens.
- End it at least 30 frames (1 second) after the cut. 45 to 60 frames reads more calmly.
- Never put a b-roll edge on the cut or within 5 frames of it. The jump shows on that edge.
- When two cuts are less than 2 seconds apart, cover both with one longer shot, or with two shots back to back. Back to back means the second starts on the frame the first ends. Clips on one track can't overlap.
- A ripple closes the gap only on the talking clip's own track. Cut first, then place b-roll from a fresh `get_project`. B-roll you placed earlier, past the cut, now sits late by the frames you removed, so move it left by that many.

Say Loaf Around Bakery's owner talks to camera for 40 seconds. You took out a stumble, and the cut now sits at frame 216 (7.2 seconds). A shot of loaves coming out of the oven runs from frame 204 to 264, 12 frames before the cut and 48 after:

```json
{"op":"add_clip","trackId":"o1","clip":{"type":"video","assetId":"A","start":204,"duration":60,"in":0,"speed":1,"volume":0,"transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"cover"}}}
```

Not every jump cut needs hiding. Quick Shorts often keep them on purpose, as rhythm. Hide the ones in the middle of a sentence and the ones where the head moves a lot. If the space has a saved style (`get_editing_guide` with the space), let it decide. A "quick" or "rapid" pace usually keeps jump cuts as part of the rhythm, and its `shotSeconds` tells you how long to hold each b-roll shot.

## Show what is said

The best b-roll shows the thing the speaker names, while they name it. Caption lines tell you when that is.

First, turn captions on for the talking clip if they aren't on yet. That works when the file already has saved captions. If it doesn't, ask the person to press Auto captions in the editor's Captions tab. Never write the words yourself.

```json
{"op":"update_clip","clipId":"c1","patch":{"captions":true}}
```

Then read `get_project`. Each caption line under the caption track has its time and its text, like `4.20–6.10s  "we fold the dough by hand"`. Match the things and actions in each line to clips by name and event: `list_assets` with search "dough" or "fold". Place the shot from the line's start, or 3 to 6 frames before it, to the line's end or on to where the next idea starts. Cut b-roll in and out with plain cuts, and save fades for picture-in-picture.

A caption line gives its start and end, not each word's. A line breaks at a pause, at the end of a sentence, and in the default look at 28 characters, so most lines run 1 to 2.5 seconds, about one b-roll shot. For the line above, 4.20 seconds is frame 126, so the shot of hands folding dough starts at 123 and ends at 183 (6.10 seconds):

```json
{"op":"add_clip","trackId":"o1","clip":{"type":"video","assetId":"B","start":123,"duration":60,"in":90,"speed":1,"volume":0,"transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"cover"}}}
```

What to show, strongest first:

- The thing named. "Our new gravel bike" gets the bike.
- The action described. "We fold the dough" gets hands folding.
- The result or the reaction. The Puddle Lane FC coach says "and then she scored", so show the goal, then the bench jumping up.

Don't show something the speaker isn't talking about. Leave the face up for feelings, opinions and the call to action, since people trust a face there.

Names like "IMG_4412.MOV" tell you nothing. Then ask, and make the question easy to answer. List the lines you want to cover with their times, and ask which clip shows each one: "At 12.4 s the coach says 'the corner kick'. Which clip has it?"

## Picture-in-picture

Picture-in-picture keeps two things on screen at once: a study channel's notes with the host's face in a corner, a bike shop's close-up of a gear beside the mechanic, a band's rehearsal clip inside an interview.

With `fit` set to "contain", the whole picture fits inside the frame, and `scale` then shrinks it. `x` and `y` place its center as shares of the frame. A 16:9 clip in a 16:9 project at `scale` 0.35 is 672 × 378 px, 35% of the frame each way, so its edges sit 0.175 either side of its center. Keep every edge inside the safe area. Outside 9:16 that is 5% in from each side, unless `get_project` shows a "Safe area" line of the project's own.

Here is a card in the bottom right corner of a 16:9 video, with soft corners. Its right and bottom edges land at 0.95:

```json
{"op":"update_clip","clipId":"c4","patch":{"transform":{"fit":"contain","scale":0.35,"x":0.775,"y":0.775},"rounding":0.1}}
```

`transform` merges, so the clip keeps its rotation and opacity. `rounding` runs from 0 (square corners) to 1 (as round as the short side allows).

For a round face bubble on a study channel's 16:9 video, the screen recording fills `v1` and the host's clip goes on the overlay track above it. Crop the host's 16:9 clip to a square (21.875% off each side), make it fully round, and put it bottom left:

```json
{"op":"update_clip","clipId":"c5","patch":{"transform":{"fit":"contain","scale":0.3,"x":0.14,"y":0.8,"crop":{"left":0.21875,"top":0,"right":0.21875,"bottom":0}},"rounding":1}}
```

Now the voice comes from the overlay clip. Keep that track unmuted, and set the screen recording's `volume` to 0 if it has sound.

In a 9:16 short, a wide clip at "contain" and `scale` 0.88 is 88% of the width and about 28% of the height. At `y` 0.3 it runs from 16% to 44% down the frame, inside the safe area and clear of captions at their default spot:

```json
{"op":"update_clip","clipId":"c6","patch":{"transform":{"fit":"contain","scale":0.88,"x":0.5,"y":0.3},"rounding":0.08}}
```

You can't see where the speaker's face is, so tell the person where you put the card and ask them to check. They can drag it in the preview.

Keep a picture-in-picture up for at least 2 seconds, and fade it in and out so it doesn't blink:

```json
{"op":"update_clip","clipId":"c4","patch":{"transitionIn":{"kind":"fade","frames":6},"transitionOut":{"kind":"fade","frames":6}}}
```

## Stock clips and photos

You can't search stock footage yourself. If the editor offers it, the Media tab has a Stock library button with free videos and photos from Pexels. Ask the person to add what you need, and give them search words: two or three concrete ones, like "kneading dough close up" or "bike lane rain". What they add uploads into the space's library like any other file. Its name usually describes the clip and includes "pexels", so `list_assets` with search "pexels" finds it.

- Use the person's own footage first. Stock is for what they can't film: a skyline, a packed stadium, rain on a window. A few stock shots keep the video theirs.
- Check the size `list_assets` gives. A wide clip (1920x1080) at "cover" in a 9:16 project shows only its middle third. Pick tall clips for Shorts. If a wide one has to stay, the clip's Reframe section in the editor has a "Reframe to follow the action" button. It fills the frame and moves the picture to keep the motion in view. It follows movement, not faces. Suggest it to the person.
- Stock is often sharper and more polished than phone footage, so it stands out. To match them, see the color topic (`get_editing_guide` with topic "color-and-looks").
- Never make up an asset id for a clip you hope is there. Wait until it shows up in `list_assets`.

Photos work as b-roll too: a menu board, the student council's election flyer, a screenshot of a recipe. `add_media` gives an image 3 seconds. A slow push keeps a still from looking frozen. For a 90-frame photo:

```json
{"op":"update_clip","clipId":"c8","patch":{"keyframes":{"scale":[{"at":0,"value":1},{"at":89,"value":1.08,"ease":"ease_in_out"}]}}}
```

When you're done, tell the person which shots you placed and at what times, so they can swap any of them in the editor.

## Common mistakes

- Cutting b-roll into the talking clip's own track. The voice goes with the picture you removed.
- Adding the overlay track without an `index`, so b-roll draws over titles and captions.
- Leaving b-roll at `volume` 1, so its room noise or music fights the voice.
- Muting the track that holds the voice, like the face clip in picture-in-picture.
- Starting or ending a shot right on the jump cut, where the jump still shows.
- Covering the whole video. People forget who is talking. Show the face for the hook, the main point and the ending.
- Ripple-cutting the talking clip and leaving b-roll placed past the cut where it was, so it lands late.
- Starting a phone clip at `in` 0, so the shot opens on the camera settling.
- Guessing what "IMG_2231.MOV" shows instead of asking.
