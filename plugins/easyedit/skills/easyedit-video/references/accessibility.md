# Videos everyone can follow

Read this when you check that a video works for people who watch muted, see less, can't tell some colors apart, are sensitive to flashing, or read slowly.

## The short version

- Turn captions on for every clip where someone talks, and fix the names and numbers they get wrong. Lots of people watch muted, and some can't hear at all.
- Give every line of text a shadow, an outline or a box. When you pick a text color and a box color, aim for a contrast of at least 4.5 to 1.
- Size text against the frame. Nothing people need to read goes below 48 px for every 1080 px of the frame's shorter side: 48 px in a 9:16 or 16:9 project, 96 px in 4K.
- Leave text up long enough to read. For a broad audience that's about 2 words a second and at least 2 s. Never go faster than 3 words a second or shorter than 1.5 s. Work in frames at the project's fps: 2 s is 60 frames at 30 fps.
- No more than 3 flashes in any one second, and aim for one or fewer. Count dips, brightness keyframes and quick cuts between bright and dark shots. Never flash saturated red.
- Don't let color carry meaning by itself. Add a word, a weight, an underline, a dash style or a shape.
- If something matters and only shows in the picture, ask the person to say it out loud or put it in the post's description. If a sound matters, label it in text.
- Follow the space's saved style, but no style overrules the flash limit.

## Captions on, and right

Captions help more people than anything else on this page. People who are deaf or hard of hearing need them. So does anyone on a bus with the sound off.

- **Shorts, Reels and TikToks:** on for every talking clip, not just some.
- **Long-form 16:9:** ask whether they want captions drawn into the picture. Turn them on and fix them either way. If they'd rather post a subtitle file, hide the Captions track (its id is in `get_project`). The lines stay, but nothing is drawn. The person then downloads a .srt or .vtt under Subtitle files in the Captions tab and uploads it with the video, so viewers can switch captions on. The download stays grayed out until some clip has captions on, so don't turn them off instead.

Turn them on in one batch:

```json
[
  {"op":"update_clip","clipId":"c1","patch":{"captions":true}},
  {"op":"update_clip","clipId":"c3","patch":{"captions":true}}
]
```

For a subtitle file only, hide the Captions track after that:

```json
{"op":"update_track","trackId":"t3","patch":{"hidden":true}}
```

If a file has no saved words yet, ask the person to press Auto captions in the Captions tab, then try again. Never type captions yourself.

The people who rely on captions are the ones a wrong word hurts most. A misheard street name or price is worse than a missing line. Read the caption lines in `get_project` and fix names, numbers and brand words with `splice_caption_words`. The details are in `get_editing_guide` with topic "captions".

- Keep caption words white. The black outline (block, karaoke, word) or the dark box (bar) gives them their contrast.
- The karaoke highlight is a bonus cue. The words are all there without it, which is how it should be.
- If the person says captions are hard to read over bright or busy footage (snow, a white kitchen, stage lights), switch to bar, which puts the words on a dark box. Leave the size alone:

```json
{"op":"set_caption_style","patch":{"preset":"bar"}}
```

- Captions show speech only. Music, sound effects and laughter aren't in them. See the last section for sounds that carry meaning.

## Contrast you can count on

You can't see the footage, so assume part of it is bright and part of it is dark. Plain white text with nothing behind it will get lost somewhere.

- **Shadow** for big, bold titles: `shadowColor` #000000, `shadowBlur` about 15% of the font size, `shadowY` about 6%, and `shadowOpacity` 0.6 or more. A shadow color alone does nothing you can see, because blur and offset start at 0.
- **Outline** for bold display fonts: `outlineColor` and `outlineWidth`, about 8% of the font size (8 px at 96 px). Thin fonts get fuzzy with an outline, so give them a box.
- **Box** for anything people must read in full, such as steps, prices, dates and name tags: `backgroundColor` with `backgroundOpacity` 0.8 or more. Below that, the footage shows through and eats the contrast.

When text sits on a solid box, you can check the pair. The web's rule for normal text is a contrast of at least 4.5 to 1, and 7 to 1 is better for small text. Some real numbers:

| Text on box | Contrast | Verdict |
|---|---|---|
| #ffffff on #000000 | 21 to 1 | Best |
| #000000 on #FF8A3D (warm orange) | 9 to 1 | Good |
| #ffffff on #15803d (dark green) | 5 to 1 | Fine |
| #ffffff on #FF8A3D | 2.3 to 1 | Too low |
| #ffffff on #22c55e (bright green) | 2.3 to 1 | Too low |
| #FFD400 (yellow) on #ffffff | 1.4 to 1 | Unreadable |

A rule of thumb: light text goes on dark boxes, and dark text goes on light or bright boxes. A bakery with a warm orange brand keeps its orange box and switches the words to black:

```json
{"op":"update_clip","clipId":"c2","patch":{"style":{"color":"#000000","backgroundColor":"#FF8A3D","backgroundOpacity":1}}}
```

Style patches merge, so send only the fields you change. Setting backgroundColor, outlineColor or shadowColor to null removes that effect. For more on text looks, see `get_editing_guide` with topic "on-screen-text".

## Text size, by frame height

A quick check is to divide the font size by the frame's height. Here's what reads well on a phone:

| Format | Frame height | Smallest text | Body and captions | Titles |
|---|---|---|---|---|
| short_9x16 | 1920 | 48 px (2.5%) | 56–80 px (3–4%) | 96 px and up (5%+) |
| feed_4x5 | 1350 | 48 px (3.6%) | 56–80 px (4–6%) | 96 px and up (7%+) |
| square_1x1 | 1080 | 48 px (4.4%) | 56–80 px (5–7%) | 96 px and up (9%+) |
| long_16x9 | 1080 | 48 px (4.4%) | 56–80 px (5–7%) | 96–140 px (9–13%) |
| long_4k | 2160 | 96 px (4.4%) | 112–160 px (5–7%) | 192–280 px (9–13%) |

Why are the shares different? A phone fits every format to its width. A 9:16 frame fills the whole screen, so a small share of its height still comes out big. A 16:9 frame is a thin strip until someone turns the phone, so its text needs a bigger share. For a custom size, use 48 px for every 1080 px of the shorter side.

- The body and lower-third presets (40 and 44 px) sit just under the floor. That's fine for a line nobody needs. When the words matter, raise them. A cooking channel's 16:9 step list:

```json
{"op":"update_clip","clipId":"c10","patch":{"style":{"fontSize":56}}}
```

- Presets don't grow with the frame. In 4K, the title preset's 96 px is only the smallest size, so raise titles to 192 px or more.
- What shows on screen is fontSize times the clip's scale. A 64 px line at scale 0.75 draws at 48 px. Check both in `get_project`.
- Below about 64 px, use weight 500 or more and a plain sans such as Geist, Inter, Roboto or Open Sans. Keep script and marker fonts (Pacifico, Lobster, Caveat, Permanent Marker) for a word or two of decoration, never for anything people must read.
- ALL CAPS is harder to read past about four words. Use sentence case for longer lines.
- Until someone changes the caption style, the caption size follows the frame's width. Once it's been changed, it stays put through `set_format`. After a format change, check the "Captions:" line in `get_project` and set a size from the table. A 70 px caption from a 9:16 project is too small in 4K.

## Time to read

People read at different speeds. Kids, people reading in a second language and people with dyslexia need more time. Use two speeds:

| Words | Fastest: 3 a second, at least 1.5 s | Relaxed: 2 a second, at least 2 s |
|---|---|---|
| 3 | 1.5 s = 45 frames at 30 fps | 2 s = 60 frames |
| 6 | 2 s = 60 frames | 3 s = 90 frames |
| 9 | 3 s = 90 frames | 4.5 s = 135 frames |
| 12 | 4 s = 120 frames | 6 s = 180 frames |

Use relaxed when the audience is broad: a school club, a study channel, a recipe's steps, a shop's opening hours. Use fastest only for short punchy lines in a quick Short. Always count frames at the project's fps, which is on the first line of `get_project`. At 24 fps, 2 s is 48 frames.

- Anything people may want to write down, such as a date, an address, a handle or a price, gets 3 s or more and stays still.
- In and out animations take time from the clip. Add their frames on top of the reading time, and skip "typewriter" on anything longer than a few words.
- Don't ask people to read two things at once. While captions run, keep other text short, or let it wait for a pause.
- You can't change how fast someone talks, but you can make it worse. Speeding a talking clip up speeds its captions too. At speed 1.25, a person talking 160 words a minute becomes 200. Most people read captions comfortably up to about 160 to 180 words a minute, so leave talking clips at speed 1 unless asked. For a fast talker, prefer the block or karaoke caption look over word, which shows one word at a time.

## No more than 3 flashes a second

Flashing can cause seizures in people with photosensitive epilepsy. A flash is a large part of the frame getting much brighter and then going back, or much darker and back. The limit is 3 in any one-second window: 30 frames at 30 fps, 24 at 24 fps, 60 at 60 fps. Aim well under it, at one a second or fewer. Saturated red flashes are the riskiest, so never flash a full frame of red.

In EasyEdit, these make flashes:

- **Dips.** A dip pair (`transitionOut` on one clip, `transitionIn` on the next) is one flash. That counts white dips between darker shots and black dips between bright ones.
- **Brightness keyframes** that jump up and fall back, like a "flash on the beat".
- **Opacity keyframes with "hold"** that blink a large bright clip or shape on and off.
- **Quick cuts** between bright and dark shots. Each cut to a much darker shot and back is one flash, so swapping every 5 frames at 30 fps is already 3 a second.
- **The footage itself:** strobes, camera flashes, lightning, fireworks, club lights.

A band's teaser cuts every half beat at 120 BPM (7 or 8 frames a shot) with a white dip on every cut. That's 4 flashes a second. Keep the dip on the drop and take the rest off. Each dip you remove is two ops:

```json
[
  {"op":"update_clip","clipId":"c4","patch":{"transitionOut":null}},
  {"op":"update_clip","clipId":"c5","patch":{"transitionIn":null}},
  {"op":"update_clip","clipId":"c5","patch":{"transitionOut":null}},
  {"op":"update_clip","clipId":"c6","patch":{"transitionIn":null}}
]
```

If they want a hit on the beat, one soft brighten that settles over 9 frames, once, is plenty. The ease goes on the first keyframe, because it shapes the move to the next one:

```json
{"op":"update_clip","clipId":"c9","patch":{"keyframes":{"brightness":[{"at":0,"value":0.35,"ease":"ease_out"},{"at":9,"value":0}]}}}
```

- The glitch and VHS effects change 12 times a second. They jitter rather than flash, but on a full frame for long they bother people who are sensitive to flicker. Keep them to short accents.
- Strong motion can make some people feel sick. Keep the shake emphasis, whips and big zooms to moments, not every cut.
- You can't see the footage. When names or events hint at strobes (a gig, a party, fireworks, a storm), ask. If the flashing stays in, put a warning at the start and in the post's description. Use `add_text` with preset "subtitle", text "Contains flashing lights", start_seconds 0 and duration_seconds 3. Then, with the id from the result, lift it to the top of the safe area and give it a box:

```json
{"op":"update_clip","clipId":"c8","patch":{"transform":{"y":0.2},"style":{"backgroundColor":"#000000","backgroundOpacity":0.8}}}
```

## Not by color alone

About 1 in 12 men and 1 in 200 women see some colors differently. Red and green get mixed up most, then green and brown, and blue and purple. Before you hand a video back, ask yourself whether it would still make sense in black and white.

- **Right and wrong.** A trivia Short reveals the right answer in green. Say it in words too, and make it bold and underlined. In "29 is prime", the "29" runs from character 0 to 2 (the end isn't included):

```json
{"op":"update_clip","clipId":"c7","patch":{"text":"29 is prime","spans":[{"from":0,"to":2,"color":"#4ADE80","fontWeight":800,"underline":true}]}}
```

- **Two sides.** A soccer club's tactics clip shows runs in yellow for Puddle Lane FC and white for the other team. In black and white those look the same. Make the other team's arrows dashed as well, and label each side once with text:

```json
[
  {"op":"update_clip","clipId":"c11","patch":{"dash":"dashed"}},
  {"op":"update_clip","clipId":"c12","patch":{"dash":"dashed"}}
]
```

- **Status.** A café's menu card that grays out sold-out items should say "Sold out" next to them.
- **Pointing at things.** Draw an arrow or a box on a shape track (see the guide's Shapes section) rather than tinting the thing. Arrow and label together beat either alone.
- When you pick two colors that must look different, pick ones that differ in lightness too, like yellow and dark blue, not red and green.

## Say what the picture (and the sound) shows

Some people can't see the picture. Some listen while they cook or drive. And words drawn into a video are just pixels, so screen readers can't read them.

- When the key facts are only on screen (the final score on the scoreboard, the price tag, the oven dial at 425°F, the finished bike after the fix), ask the person to say them in the voiceover, or to put them in the post's description. You can't record a voice, but you can point out what's missing.
- A video that's only text over music says nothing to someone who can't see it. Offer two fixes: a short voiceover, or the same words in the post's description.
- When the speaker says "this one" or "as you can see", add a label that names the thing. A bike shop owner pointing at a part: `add_text` with preset "subtitle" and the text "Tubeless valve", plus an arrow. It helps everyone, not just people who can't see well.
- Sounds that carry meaning aren't in the captions: the oven timer, the final whistle, a doorbell that sets up the joke. Label them in square brackets, away from the captions, but only sounds the person tells you about. You can't hear the footage, so never guess. A cooking creator's timer at 8 s (frame 240 at 30 fps), on a text track that's free then:

```json
{"op":"add_clip","trackId":"t2","clip":{"type":"text","start":240,"duration":60,"text":"[oven timer beeps]","transform":{"x":0.5,"y":0.22,"scale":1,"rotation":0,"opacity":1,"fit":"contain"},"style":{"fontFamily":"Inter","fontSize":48,"fontWeight":600,"color":"#ffffff","align":"center","italic":true,"backgroundColor":"#000000","backgroundOpacity":0.8}}}
```

A good question to ask before you finish: "Is there anything people need to know that only shows in the picture or only comes through in a sound?"

## When the space has a saved style

When you read the guide with the project's space (`get_editing_guide` with space), it ends with "## This space's style". Follow it, within these limits:

- **Captions off.** If its captions field says off, follow it. Say once that captions help viewers who can't hear or who watch muted, and offer to add them to this video.
- **Fast pace or lots of transitions.** Follow the pace, but keep to the flash limit. If some dips had to come out, tell the person in one line why.
- **Bright footage.** Reference videos list a brightness from 0 to 1. If they run bright (about 0.6 or more), plan on boxes behind text from the start. It's an average, so a low number doesn't make bare white text safe.
- **Fast talkers.** Reference videos also list words a minute. Above about 180, plan on block or karaoke captions, and never speed the talking up.
- **Keeping a rule.** If the person wants an access rule kept for good, offer to add it to the style's always list. With their OK, and if they're an editor or admin, call `save_style` with the space and fields `{"always":["Captions on for every talking clip","No more than one flash a second"]}`. The list holds up to 8 rules. A new list replaces the old one, so send the rules already there along with the new ones. People can also edit it under Settings → Style.

## Common mistakes

- Captions on for some talking clips and not others, or left full of misheard names and prices.
- Turning captions off when the person wanted a subtitle file. Hide the Captions track instead, so the file still has lines.
- White text with nothing behind it over footage you haven't seen, or a box at 0.4 opacity that lets the footage wash it out.
- 40 px body text in a 16:9 project, 96 px titles left as they are in 4K, or a clip scaled to 0.7 so a readable size draws too small.
- A date, address or handle on screen for 1.5 s, or a typewriter animation eating the reading time.
- White dips, beat flashes and bright and dark cuts that add up to more than 3 flashes in one second, or any full-frame red flash.
- Right and wrong, two teams, or sold out shown by color alone.
- Key facts that live only in the picture, with no voiceover or description line to carry them.
- Writing sound labels or captions for sounds and words you guessed at.
