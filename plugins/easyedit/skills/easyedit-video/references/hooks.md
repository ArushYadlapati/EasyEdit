# Open strong

Read this when you are shaping the first 1–3 seconds of a short video: the opening shot, the first words, the first text and the first frame people see.

## The short version

- Start on the best moment, not the beginning: the goal, the finished cake, the reveal. The build-up can come after.
- Put the first text on screen at frame 0. Keep it to about six words, readable within 1.5 seconds (45 frames at 30 fps).
- Make frame 0 look finished. No fade from black on the first clip, and no first text that fades, pops or types in from nothing.
- Cut the warm-up: "hey guys", logos, slow pans, counting in. If the first two seconds aren't the point, they go.
- Change something by second 2 or 3: a new shot, a punch-in, or a second line of text.
- In 9:16, put hook text high in the safe area (y about 0.3), clear of the captions and the app's buttons.
- Read the space's style first. How they say they open beats every default here.
- You can't watch the footage. Use caption lines, file names, events and lengths, and ask which moment is the best one.

Numbers here assume 30 fps. Ops take whole frames, so multiply seconds by the project's fps from the first line of `get_project`: 1.5 seconds is 45 frames at 30 fps, 36 at 24 and 90 at 60.

## Start at the best moment

Most raw footage starts slow. The camera gets set up, someone says "okay, go", the dough is still flour. The part worth stopping for is usually later: the result, the peak, the surprise. Lead with it.

Openers that work:

- **Result first.** A cooking creator opens on the finished pasta, then shows how it was made.
- **Peak first.** A soccer club's match recap opens on the winning goal, not the warm-up laps.
- **Flash forward.** A bike shop shows 1.5 seconds of the trued wheel spinning, then goes back to the bent one: "Here's how."
- **Straight to the claim.** A study channel opens mid-thought on the promise, with no greeting.
- **The news.** A student council opens on "Spring formal tickets: Friday", not on the school logo.

You can't see or hear the media, so find the moment another way:

- When a clip has captions on, `get_project` lists each caption line with its time. The line that says the result or the surprise is often your opener.
- File names and events from `list_assets` help: "final-whistle.mp4" or "cake-reveal.mov" tell you a lot.
- Ask. "Which moment would make you stop scrolling?" is a fair question. Offer two choices you found.

**In EasyEdit.** Building from scratch, make the best moment the first item of `add_media`, with in_seconds where it starts and duration_seconds for how long it runs.

To cut a slow start off the first clip, split it where the good part begins and remove the front with ripple. `at` is a timeline frame, not a frame into the clip. Here a band's live clip "c1" starts at frame 0 and loses the drummer's two-second count-in (60 frames):

```json
[
  {"op":"split_clip","clipId":"c1","at":60},
  {"op":"remove_clip","clipId":"c1","ripple":true}
]
```

`split_clip` keeps "c1" for the first half, so this removes the count-in and pulls the rest of that track 60 frames earlier. Ripple only moves clips on the same track. Captions follow their clip, but text, music and other tracks stay where they were. Move whatever belongs to later moments by the same 60 frames, or read the project again and check.

For a flash forward, put a short piece of the payoff in front with ripple. The bike shop's trued wheel spins 41 seconds into its file, which is frame 1230 at 30 fps:

```json
{"op":"add_clip","trackId":"v1","ripple":true,"clip":{"type":"video","assetId":"a7","start":0,"duration":45,"in":1230,"speed":1,"volume":1,"transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"cover"}}}
```

That plays 1.5 seconds of the ending, then the story from the top. The same rule holds: only "v1" moves right. Leave the hook text at frame 0, and shift the text and music that go with later moments by 45 frames.

Long-form YouTube follows the same idea at a gentler pace. Say what the viewer gets in the first 5 to 10 seconds, show a glimpse of the payoff if you have one, and be into the real content within about 30 seconds.

## The first words

What people hear and read in the first second should be the promise of the video.

Lines that open well:

- Say the result: "This wheel was bent like a taco. Now look."
- Name the problem: "Your bread is flat because of one step."
- Ask what they're wondering: "Can you learn 200 flashcards in a week?"
- Promise a list: "Three drills for a faster first touch."

Lines to cut from the front:

- Greetings: "Hey everyone, welcome back to the channel."
- Setup with no point yet: "So, today I wanted to talk about..."
- Apologies: "Sorry it's been a while."

When the clip is captioned, find the first caption line worth staying for. If it starts four seconds in, cut what comes before it, as above.

If the best line comes later still, ask before you bring it to the front: changing the order of what someone says changes what they mean. Once they agree, make a teaser. Add a copy of that moment at frame 0 with `add_clip` and ripple, like the flash forward above, and leave the original where it is. The copy's `in` is the source clip's `in` plus how far into that clip the line starts (times its speed). Put `"captions":true` in the copy so its words show too.

Never rewrite caption words to make a better hook. They are what was said, and `splice_caption_words` is only for fixing words the captions heard wrong. If the person wants a sharper line, put it in a text clip.

If a talking clip has no captions yet, try turning them on with `update_clip` and `{"captions":true}`. That works when the file already has saved captions. If it doesn't, ask the person to press Auto captions in the editor's Captions tab, then read the project again. Or ask them what the strongest line is and roughly when it's said.

## Text on frame 0

Many people scroll with the sound low or off, so the first text does the work the voice can't.

- Start it at frame 0. Not frame 10, and not after a logo.
- Three to six words, one idea. "Flat bread? Fix this step" beats "Sourdough tips".
- Keep it up at least 1.5 seconds (45 frames). Two to three seconds is typical for the first line.
- Make it big: the title preset's 96 px or larger in 9:16.
- Keep it inside the safe area. By default 9:16 keeps the top 14%, the bottom 35% and 6% at each side clear. If `get_project` shows a "Safe area" line, use that box instead.
- Keep it off the captions. Captions sit low in the safe area by default, around y 0.56, and the title preset sits at y 0.5, close enough to run into them. Once a project has captions, the "Captions" line of `get_project` gives their real y. Move hook text up to about y 0.28 to 0.32, or well away from wherever they sit.
- Make it readable over busy footage with an outline or a box behind it.
- Let the text and the voice agree. The text is the short form of the first spoken line, not a second message that competes with it.

**In EasyEdit.** `add_text` with preset "title", start_seconds 0 and duration_seconds 2.5 gives you a clip in the space's brand kit title font. Then, with the new clip's id and the version from that result, move it up and give it an outline:

```json
{"op":"update_clip","clipId":"c5","patch":{"transform":{"y":0.3},"style":{"fontSize":110,"outlineColor":"#000000","outlineWidth":6}}}
```

A box behind the text works too, and can carry brand colors. A bakery with cream and dark brown:

```json
{"op":"update_clip","clipId":"c5","patch":{"style":{"color":"#3b2416","backgroundColor":"#fff4e0","backgroundOpacity":0.95,"backgroundPadding":0.3,"backgroundRadius":0.25}}}
```

To make one word stand out, give it its own color with `spans`. Characters count from 0, and `to` is the first one left out. In "3 mistakes ruining your sourdough", the word "ruining" runs from 11 to 18:

```json
{"op":"update_clip","clipId":"c5","patch":{"spans":[{"from":11,"to":18,"color":"#FFD400"}]}}
```

## Frame 0 is the thumbnail

Feeds show the first frame while a video loads, and some apps use it as the cover unless the person picks one. Treat frame 0 like a poster.

A good frame 0 has:

- A real picture: the subject in view, sharp and well lit. Not black, not mid-swipe, not a blank wall.
- The hook text already fully drawn.
- One clear thing to look at: a face, the product, the ball, the dish.

Check `get_project` for what sits at frame 0. These leave it empty:

- A gap. The first video clip starts after 0.00s, often after a `remove_clip` without ripple, so the video opens on black. Move it to frame 0, or remove with ripple next time.
- A `transitionIn` on the first clip. "fade" and "zoom" start almost see-through over black, "dip" starts as a solid color, and "slide" and "whip" start off to the side. Take it off:

```json
{"op":"update_clip","clipId":"c1","patch":{"transitionIn":null}}
```

- An `animationIn` on the first text. "fade", "pop" and the slides start see-through, and "typewriter" starts with only its first letter or two. "scale_punch" is the one drawn in full from its first frame: it starts up to 1.4 times its size and settles, which gives the opening a small jolt too. Eight frames is about a quarter second at 30 fps:

```json
{"op":"update_clip","clipId":"c5","patch":{"animationIn":{"preset":"scale_punch","frames":8}}}
```

Because it starts larger, keep the line short so it stays inside the safe area at that size. Or set `animationIn` to null for a still, plain first frame.

- Opacity keyframes that start at 0 on a clip at frame 0. Start them at 1.

All of these are fine later in the video. Only the opener has to be drawn on its first frame.

You can't see frame 0 yourself. Tell the person which clip and moment opens the video, and ask them to scrub to the start in the editor and check it looks good.

## Keep them past second 3

The hook earns the first second. The next two need something to change, or people swipe. A pattern interrupt is any small change people notice: a cut, a jump in framing, a new line, a sound.

For the first five seconds, aim for something new every 1.5 to 3 seconds (45 to 90 frames). After that, let the content and the style's pace set the rhythm (see the pacing topic).

Options, gentlest first:

- **A cut.** The simplest interrupt. If the first shot runs past three seconds, cut to another angle or shot. Or make a jump cut: split twice around a dull stretch and remove the middle piece with ripple. A split on its own changes nothing on screen.
- **A second line of text.** End the first text at 1.5 to 2.5 seconds and start the next right after: "Flat bread?" then "It's your shaping." Each one up for at least 1.5 seconds.
- **A punch-in.** Jump a talking head's framing tighter, like a second camera. Scale keyframes with "hold" jump instead of gliding. On a study channel clip, this jumps from 1 to 1.12 at 1.5 seconds:

```json
{"op":"update_clip","clipId":"c1","patch":{"keyframes":{"scale":[{"at":0,"value":1,"ease":"hold"},{"at":45,"value":1.12}]}}}
```

Here `at` counts frames from the clip's start, not the timeline's, and the last value holds to the clip's end. A keyframed scale ignores the transform's, so start from the clip's own scale if it isn't 1. Stay between about 1.08 and 1.2: more, and the picture goes soft and heads get cut off. For a calm open, glide instead: 1 to 1.06 over 90 frames (3 seconds) with "ease_in_out" and no hold.

- **Emphasis on the hook text.** "highlight_word" lights each word in turn across the clip, "pulse" makes it breathe and "shake" keeps it jittering. Use one, on text that earns it:

```json
{"op":"update_clip","clipId":"c5","patch":{"emphasis":{"preset":"highlight_word","color":"#FFD400"}}}
```

- **A quick whip into the second shot.** Give the first clip a "whip" `transitionOut` and the second a "whip" `transitionIn`, 6 frames each and the same direction, so the motion carries through the cut. Never a `transitionIn` on the first clip:

```json
[
  {"op":"update_clip","clipId":"c1","patch":{"transitionOut":{"kind":"whip","frames":6,"direction":"left"}}},
  {"op":"update_clip","clipId":"c2","patch":{"transitionIn":{"kind":"whip","frames":6,"direction":"left"}}}
]
```

- **Sound.** A hit or a music change on the first cut; see the music and sound topic.

Don't stack them. A punch-in, a whip, a shaking word and a zoom in the same second is noise. Pick one or two for the opening.

## Follow the space's style

Before you build an opening, call `get_editing_guide` with the project's space. If the space has a saved style, the guide ends with "## This space's style".

- The hook field says how they open, in their words: "Open on the score, then the goal" or "Start talking straight to camera." Follow it over the patterns here.
- Pace and shot length tell you how often to interrupt. A "rapid" style wants a cut about every second; a "calm" one is happy with a four-second first shot and a slow push.
- The captions setting says where captions sit (upper, middle or lower). Put hook text where they aren't.
- The always and never lists may hold opening rules, like "never open on our logo".
- Reference videos that talk show their opening words. Read them for tone: do they greet, or start on the point?
- For pictures, call `get_editing_guide` with topic "style" and the space. Where your client shows images, the earliest frames on each frame sheet show what they open on: a face, the product, text on screen.

With no style saved, use the defaults here and say what you chose: "I opened on the final goal with the score as text. Want a different opener?"

If the person tells you how they like to open and wants it remembered, offer to save it with `save_style`: their space, and fields with hook set to their words, such as "Open on the finished bike, then show the before." Saving needs an editor or admin, and it changes what every agent in the space reads, so ask first. They can also change it themselves under Settings → Style.

## Common mistakes

- Opening on a logo, a title card or "hey guys, welcome back". Cut to the point.
- A fade from black on the first clip, or a fade-in on the first text, so frame 0 is empty. That's the frame on the cover and in the feed.
- Leaving hook text at the title preset's y 0.5, where default captions (around y 0.56) run into it.
- A hook that's a full sentence. Six words or fewer; let the voice and captions carry the rest.
- Promising what the video doesn't show. If the hook says "the best cookie you'll make", the cookie has to be in it.
- Cutting a slow start with ripple and forgetting only that track moved, so text and music fall out of step.
- Removing the slow start without ripple, so the video opens on a black gap.
- Guessing the best moment from file names alone when you could ask. One question saves a rebuild.
- Using every effect in the first second. One interrupt at a time.
