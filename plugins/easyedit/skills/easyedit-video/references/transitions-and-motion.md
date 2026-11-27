# Transitions and motion

Read this when you are about to add a transition, a zoom or punch-in, or animated text, or when someone asks you to make an edit feel more dynamic.

## The short version

- Cut by default. A hard cut is the right join for almost every pair of clips, and most good Shorts have no more than one transition.
- Add a transition only when it means something: time passed, the place changed, the video starts or ends, or the mood turns.
- Keep them short. At 30 fps that is 6 to 15 frames for most kinds, and up to 30 for a slow crossfade or a last fade to black. Scale to the project's fps.
- Follow the space's style. Call `get_editing_guide` with the space first. If its transitions say "cuts", add none unless you're asked.
- Move the picture instead of joining clips: a 1.1 to 1.2 punch-in on a talking head, or a slow push from 1.04 to 1.12 on a photo, with scale keyframes.
- Give each kind of text one entrance animation and reuse it. Keep it under 12 frames at 30 fps so the words can be read quickly. The first text, at frame 0, gets none.
- One effect at a time. Never put a zoom transition, a scale keyframe and a popping title on the same second.
- Afterwards, read `get_project` and check each clip's in=, out=, anim-in=, anim-out= and kf. marks. Then tell the person what you added and where.

## Start from cuts

A cut doesn't draw attention to itself. Viewers have watched cuts their whole lives and read them without effort. A transition makes them notice the edit. In a 30-second Short, a 15-frame transition is half a second where neither shot is fully on screen, every time you use one.

A transition is worth adding when it tells the viewer something:

- **Time passed.** The bakery's 5 a.m. dough prep, then the doors opening at 7. Use a dip or a slow crossfade.
- **The place or section changed.** A study channel moves from "the problem" to "the method." One dip marks the new chapter.
- **The video starts or ends.** Long-form videos can fade in from black for 10 to 15 frames and fade out for 20 to 30. A Short should not fade in: frame 0 has to show the hook already (see the hooks topic).
- **The mood is slow.** A band's tour diary set to a quiet song can take crossfades of 15 to 20 frames between shots.
- **A reveal.** The bike shop's rusty frame, then the restored one. One whip, used once.

A plain cut is better between shots of the same scene, inside a talking-head video (use a punch-in instead), in a fast list or recap, and on a cut that already lands on a music beat.

**The space's style.** When you call `get_editing_guide` with the space, the "## This space's style" section may have a Transitions line ("cuts", "few" or "lots") and a line of transition kinds they use (the transitionKinds field). Past projects in the style also list the transitions they used.

- "cuts": straight cuts. Without asking, the most you add is a fade out at the very end of a long video.
- "few": mostly cuts. One to three in a video, only at real changes of time, place or section, and only kinds from transitionKinds.
- "lots": they asked for a transition between most shots, so do that, with kinds from transitionKinds. Keep each one short, 6 to 10 frames at 30 fps, so the pace holds.
- No style saved: treat it as "few".

If someone asks for "some transitions" and doesn't say where, find the two or three real changes in the video and use one kind for all of them. Then tell them which cuts you left as cuts, and why.

## The six kinds

| kind | What it does in EasyEdit | Good for | Frames at 30 fps |
| --- | --- | --- | --- |
| "fade" | The clip fades in from, or out to, whatever is under it. On the bottom track that is black. | The start and end of a video | in 10–15, out 20–30 |
| "crossfade" | The clip blends in over the clip that ends exactly where it starts, on the same track. In only. | Time passing, slow montages, photo slideshows | 10–20, up to 30 for slow music |
| "dip" | Going out, the frame fills with one color. Coming in, the color clears. Use them as a pair. | A clear break: a new day, a new chapter | 6–10 on each side |
| "slide" | The clip travels a whole frame in from one side, or out to one side. | Lists, screen recordings, a playful "next" | 10–15 |
| "zoom" | Coming in, the clip shrinks from 1.25 times its size to its own while fading in. Going out, it grows to 1.25 while fading out. | An energetic arrival; a picture or arrow popping in | 8–12 |
| "whip" | A fast move across a whole frame, motion-blurred along the way it moves: most blurred at its fastest, sharp once it stops. A shorter whip is faster and blurs more. | Reveals and big beats in a fast edit | 6–8 on each side |

The frame counts above are at 30 fps. The first line of `get_project` gives the project's fps, and frames = seconds × fps. So 10 frames at 30 fps is 20 at 60 fps and 8 at 24 or 25 fps.

A few things to know:

- frames runs from 1 to 600. If a clip's way in and way out add up to more than the clip's length, EasyEdit squeezes them to fit. A 20-frame clip can't hold two 15-frame transitions.
- direction (slide and whip only) is the way the clip moves: "left" enters from the right, moving left. For a pair, give the outgoing clip's transitionOut and the incoming clip's transitionIn the same direction, so the motion carries through the cut.
- A slide or whip moves the clip itself. Coming in, the shot before it has already ended, so the part of the frame it hasn't reached yet shows what's under it: black on the bottom track. To slide a shot in over the last one, put it on an overlay track above and start it that many frames before the shot under it ends.
- A dip's color is hex and defaults to black, "#000000". White feels lighter and suits a bakery or a wedding. A brand color only works when it's dark or calm.
- Video, image and shape clips take transitions. Shapes take every kind except crossfade. Text uses animationIn and animationOut instead (see below). Audio clips take none.
- Transitions only change the picture. The sound still cuts at the clip's edge. To soften it, set fadeIn and fadeOut on the clip's sound, in frames.

## Setting them in EasyEdit

Every transition goes through `update_clip` in `edit_timeline`, as transitionIn or transitionOut, with the expected_version from your last `get_project`. Send the whole transition each time. Setting one to null removes it.

A study channel's 8-minute video fades in at the start and out at the end. The music fades out too, so it doesn't stop dead. Here c1 is the first clip, c9 the last, and m1 the music on the audio track:

```json
[
  {"op":"update_clip","clipId":"c1","patch":{"transitionIn":{"kind":"fade","frames":12}}},
  {"op":"update_clip","clipId":"c9","patch":{"transitionOut":{"kind":"fade","frames":24},"fadeOut":24}},
  {"op":"update_clip","clipId":"m1","patch":{"fadeOut":45}}
]
```

A soccer club's tournament recap goes from Saturday to Sunday with a crossfade. c5 starts on the exact frame c4 ends, on the same track:

```json
{"op":"update_clip","clipId":"c5","patch":{"transitionIn":{"kind":"crossfade","frames":18}}}
```

How a crossfade works:

- It needs the two clips to touch, on one track. With a gap of even one frame, or the clips on different tracks, it plays as a plain fade-in.
- The outgoing clip keeps playing under the new one for the length of the crossfade, past its own end. So it needs that much footage left after its out point. If its file runs out, its last frame freezes under the blend, which shows on moving footage. Trim it back a little to make room.
- The crossfade owns its cut, so EasyEdit ignores the outgoing clip's own transitionOut. Don't add one.

A bakery's prep clip (c3) dips to white, and the opening clip (c4) comes back out of it, for about half a second in total:

```json
[
  {"op":"update_clip","clipId":"c3","patch":{"transitionOut":{"kind":"dip","frames":8,"color":"#ffffff"}}},
  {"op":"update_clip","clipId":"c4","patch":{"transitionIn":{"kind":"dip","frames":8,"color":"#ffffff"}}}
]
```

The bike shop shows its rusty frame (c6), then the restored one (c7), with a whip pair that moves the same way:

```json
[
  {"op":"update_clip","clipId":"c6","patch":{"transitionOut":{"kind":"whip","frames":7,"direction":"left"}}},
  {"op":"update_clip","clipId":"c7","patch":{"transitionIn":{"kind":"whip","frames":7,"direction":"left"}}}
]
```

When you split a clip, `split_clip` takes the way out off the left piece and the way in off the right piece, because the split point is no longer an edge. That includes the sound's fadeOut and fadeIn. After a split, check that the transitions are still where you meant them.

## Punch-ins and slow zooms

Movement inside a clip often gives people what they wanted from a transition, without the wait. Frame numbers in these examples are at 30 fps.

First, how scale works on a full-frame clip (fit "cover"). Scale 1 fills the frame, and anything above 1 crops in. Keep full-frame video at scale 1 or more, or black edges show. If you move x or y away from 0.5 on a zoomed clip, keep the shift within (scale − 1) ÷ 2. At scale 1.2, x and y can each run from 0.4 to 0.6. Footage that isn't the frame's shape has more room along its long side.

**Punch-in.** On a talking head, cut in to 1.15 or 1.2 on a key line, then back to 1 at the next sentence. It hides jump cuts and adds energy without a transition. Use one every 5 to 8 seconds, not on every cut. Past about 1.3, phone footage starts to look soft.

If there is already a cut there (or you just made one with `split_clip`), set the second piece's transform. transform merges, so only scale and y change. Moving y down to 0.54 keeps a face in the top third of the frame in view:

```json
{"op":"update_clip","clipId":"c5","patch":{"transform":{"scale":1.18,"y":0.54}}}
```

A piece you split off c5 later copies its 1.18, so set the next sentence's piece back to scale 1 and y 0.5.

Inside one long take, use "hold" keyframes instead, so the jump lands on a frame you choose without splitting. A cooking creator says "and this is the secret" 3.2 seconds into the clip (frame 96). The picture jumps to 1.15 there and goes back to 1 at 6 seconds (frame 180):

```json
{"op":"update_clip","clipId":"c2","patch":{"keyframes":{"scale":[{"at":0,"value":1,"ease":"hold"},{"at":96,"value":1.15,"ease":"hold"},{"at":180,"value":1}]}}}
```

**Slow push.** A gentle scale change across the whole clip keeps a photo from feeling frozen. Here is a 4-second photo (120 frames) that drifts a little to the left as it pushes in:

```json
{"op":"update_clip","clipId":"c3","patch":{"keyframes":{"scale":[{"at":0,"value":1.04},{"at":119,"value":1.12}],"x":[{"at":0,"value":0.51},{"at":119,"value":0.49}]}}}
```

Change scale by 0.05 to 0.1 over 3 to 5 seconds. Much more than that looks like an effect, not a camera. Alternate pushing in and pulling out from photo to photo, so a slideshow doesn't keep diving forward. Linear is right for a slow push. Use "ease_in_out" when the clip should feel settled at both ends.

**Snap zoom.** A band's drummer hits the crash 1.5 seconds into a clip (frame 45). The picture snaps to 1.12 in 6 frames and stays there:

```json
{"op":"update_clip","clipId":"c8","patch":{"keyframes":{"scale":[{"at":45,"value":1,"ease":"ease_out"},{"at":51,"value":1.12}]}}}
```

How keyframes behave:

- at counts frames from the clip's start, so the last frame is the clip's duration − 1. Before the first keyframe and after the last, the value holds.
- When a property has keyframes, they replace that property's transform value.
- keyframes merge per property. Sending scale leaves x alone, and an empty list, [], removes scale's keyframes.
- To change one keyframe, send that property's whole list again. `get_project` shows the list as kf.scale=0:1.04,119:1.12, with the ease after any keyframe that isn't linear, as in 45:1~ease_out.
- ease is "linear" (the default), "ease_in", "ease_out", "ease_in_out" or "hold", and it shapes the travel to the next keyframe.
- A split keeps both pieces on the same curve, so a push carries on across the cut.

## Text that moves

`add_text` makes still text. To animate it, use `update_clip` afterwards with animationIn, animationOut or emphasis. Each one is replaced whole, and null removes it.

animationIn presets:

- "fade": fades in. Quiet, and it fits anywhere.
- "pop": grows in with a small overshoot, about 10%, while it fades in. Friendly. Good for titles and labels after the opening.
- "slide_up", "slide_down", "slide_left", "slide_right": moves about 8% of the frame into place while it fades in. "slide_up" rises into place. Good for lower thirds and list items.
- "typewriter": the letters appear one at a time over its frames. In only.
- "scale_punch": starts at 1.4 times its size and settles. In only. It's loud, so save it for one word or one number.

animationOut has the same presets except "typewriter" and "scale_punch". emphasis runs for the whole clip: "shake" jitters and "pulse" grows and shrinks by 5%, once every 0.8 seconds. amount scales how far it moves and speed how fast, both 1 when left out, so {"preset":"pulse","amount":0.5} is half as big. It's a rare accent: most videos need none. To light words as they're said, use karaoke captions; to make one word stand out, give it a span (see the on-screen text topic).

At 30 fps, good lengths are: fade 6 to 10 frames, pop 8 to 12, slides 8 to 12, scale_punch 6 to 10, and 6 to 8 for any way out. For typewriter, allow about 1.5 frames a character, so a 20-character line takes 30 frames. Keep it under a second, which means short lines.

A student council video uses pop for a section title and slide_up for the two event labels, with a quick fade out on the labels:

```json
[
  {"op":"update_clip","clipId":"c20","patch":{"animationIn":{"preset":"pop","frames":9}}},
  {"op":"update_clip","clipId":"c21","patch":{"animationIn":{"preset":"slide_up","frames":10},"animationOut":{"preset":"fade","frames":6}}},
  {"op":"update_clip","clipId":"c22","patch":{"animationIn":{"preset":"slide_up","frames":10},"animationOut":{"preset":"fade","frames":6}}}
]
```

Keep text motion calm and consistent:

- Give each role one entrance and reuse it: every title pops, every label slides up. A mix of presets looks random.
- The first text, at frame 0, should look finished on that frame. fade, pop, the slides and typewriter all start see-through or partly drawn. Leave it with no animationIn, or use a short scale_punch, which is drawn in full from its first frame (see the hooks topic).
- A way out is optional. A hard out keeps the pace, and if the next text appears in the same spot right away, skip the way out.
- Leave emphasis off unless one line truly needs it. Then use it on that one clip only, at a small amount, about 0.5.
- Captions are styled with the `set_caption_style` op, not with these presets. Its "karaoke" and "word" looks already change word by word, so don't put moving text right on top of them.

## One effect at a time

In EasyEdit, effects on the same clip multiply. A zoom transition scales on top of the clip's scale keyframes, and a text pop scales on top of the text's own keyframes. When two motions run in the same frames, they fight, and the viewer sees jitter instead of style.

Stick to these limits:

- One motion per clip at any moment: a push, a punch-in or a transition, never two in the same frames. If a clip has a slow push, join it with a cut or a crossfade, not a zoom.
- One join per cut: a crossfade, a dip pair or a whip pair. A fade out on one clip plus a fade in on the next makes a fade through black. That's fine when you mean it, but don't build it by accident.
- Text gets one entrance and at most one way out. Add emphasis only to text that comes in plainly, with a fade or no animation.
- Don't move the picture and the text together. If the picture punches in, let the text land with a hard cut or a fade.
- A rough budget for a 30-second Short: zero to two transitions (more only when the style says "lots"), punch-ins on at most a third of the talking clips, one style of text entrance, and usually no emphasis.

Before you hand it back, read the project with `get_project`. Each clip's line lists its effects, such as in=crossfade 0.60s, out=dip-#ffffff 0.27s, anim-in=pop 0.30s, emphasis=pulse amount 0.5 and kf.scale=0:1.04,119:1.12. (A media clip's first in=, right after asset=, is where its footage starts, not a transition.) Look for any clip with two motions at once, and remove the extra with null, or [] for keyframes. Then say plainly what you did, for example: "I added a white dip between the prep and the opening, 8 frames on each side, and a slow push on the three photos. Every other join is still a hard cut." People can undo any change from the editor's Activity list.

## Common mistakes

- A transition on every cut when the style doesn't ask for it. It slows the video down and makes it look like a template. Start from cuts.
- Fading a Short in from black, or animating its first text in. Frame 0 should show the hook, and a 15-frame fade hides it for half a second.
- A slide-in with nothing under it, so black shows behind the moving shot. Put the incoming shot on an overlay track over the end of the last one.
- A crossfade across a gap or between two tracks. The incoming clip has to start on the exact frame the outgoing one ends, on the same track, or it plays as a plain fade.
- Transitions longer than 20 frames in a fast edit, or a way in and way out longer than the clip itself, which EasyEdit then squeezes.
- Full-frame video zoomed below scale 1, or a zoomed clip moved more than (scale − 1) ÷ 2, so black edges show.
- Forgetting the sound: a fade to black while the music plays on at full volume. Set fadeOut on the clip and on the music too.
- A zoom transition, a scale push and a popping title all on the same second.
- Four different text presets in one video. Pick one per role and reuse it.
