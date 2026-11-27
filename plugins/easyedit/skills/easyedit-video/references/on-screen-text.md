# Titles and on-screen text

Read this when you add a title, a hook line, a list, a name tag or any other words on screen, or restyle text already in a project.

## The short version

- Start with `add_text` and a preset ("title", "subtitle", "body" or "lower-third"). It uses the space's brand kit fonts and finds a free text track for you. Restyle afterward with an `update_clip` op in `edit_timeline`.
- If the guide ends with "## This space's style", its text setting and its always and never lists come before the defaults here.
- Put one idea in each text clip, about six words at most. Show no more than two sizes of text at once.
- Leave each clip up long enough to read: about 3 words a second, and never less than 1.5 s. Six words need 2 s, which is 60 frames at 30 fps. Always work from the project's own fps.
- Keep every line inside the safe area. In 9:16 that means y between 0.14 and 0.65 and x between 0.06 and 0.94, unless get_project shows a "Safe area" line with the project's own box.
- Make text readable over any footage with a shadow, an outline or a box behind it.
- Animate in and out quickly (6 to 12 frames at 30 fps). Most videos need no emphasis; use it on one line at most.
- Stay with the brand fonts and the sizes already in the project unless the person asks for a change.

## Start from a preset and the brand fonts

`add_text` takes up to 20 items. Each item has text, and can also have a preset, start_seconds, duration_seconds and track_id. It needs expected_version, just like `edit_timeline`. If you leave things out, it uses preset "title", starts at 0 and lasts 3 s. Give every item its own start_seconds. If you don't, they all start at 0 and stack up on separate tracks.

| Preset | Size | Weight | Align | y | Font from the brand kit |
|---|---|---|---|---|---|
| "title" | 96 px | 700 | center | 0.5 | title font |
| "subtitle" | 56 px | 500 | center | 0.6 | subtitle font |
| "body" | 40 px | 400 | center | 0.7 | body font |
| "lower-third" | 44 px | 600 | left | 0.62 | body font |

Sizes are in project pixels, so they fit the 1080-wide formats (9:16, 4:5, 1:1) and look fine at 1920 wide. `add_text` doesn't scale them. In a long_4k project, which is 3840 wide, double every size, outline and shadow: a title at 192 px, body text at 80 px.

The answer lists the new clip ids and shows the project, with each text clip's font, size, weight, color, align, x and y. The font is the brand kit's, at the weight nearest the preset's that the font has, so keep it. If you build a text clip yourself with `add_clip`, copy fontFamily and fontWeight from a text clip that `add_text` made in the same project. The examples below use Geist and Inter only as stand-ins.

A font that isn't on the guide's list gets drawn in a fallback font. Some display and script fonts only have weight 400: Anton, Archivo Black, Audiowide, Bangers, Bebas Neue, DM Serif Display, Lobster, Pacifico, Permanent Marker, Righteous and Russo One. With those, use size to set lines apart, not weight.

Build a clip by hand when you want its look set from the start. Its trackId must be a text track (get_project marks them [text]). Here is a bike shop's hook, with a manual line break and an outline:

```json
{"op":"add_clip","trackId":"t1","clip":{"type":"text","start":0,"duration":60,"text":"Flat tire?\nFixed in 10 min","transform":{"x":0.5,"y":0.3,"scale":1,"rotation":0,"opacity":1,"fit":"contain"},"style":{"fontFamily":"Geist","fontSize":96,"fontWeight":700,"color":"#ffffff","align":"center","outlineColor":"#000000","outlineWidth":8}}}
```

## Follow the space's style

If you called `get_editing_guide` with the space and the guide ends with "## This space's style", follow its text setting. "none" means no on-screen text beyond captions, so ask before you add any. "light" means a hook line and maybe an end card. "lots" means a line every few seconds. Past projects in the style list their text clips a minute and their fonts, so match those. Its always and never lists may hold text rules too, such as "always uppercase titles". When someone gives you a rule they want kept for good, offer to save it to the style with `save_style` (editors and admins can), or point them to Settings → Style.

## Hierarchy: one thing to read first

People scan a frame in under a second. Give them one obvious place to start.

- Use each preset for one job. "title" is the point or the hook. "subtitle" is the line that backs it up. "body" is for details, steps and lists. "lower-third" says who or where.
- Show two levels at most at once. Make the main line about 1.5 to 2 times the size of the second. The presets' 96 px and 56 px are a good pair.
- Use the same preset, size and y for the same job all the way through. On a study channel, "Tip 1", "Tip 2" and "Tip 3" should all be body lines at the same y, so each new one reads as the next step.
- Break lines where the meaning breaks. Put "\n" in the text ("Fresh bread\nevery Saturday") instead of letting it wrap wherever the width runs out.
- Uppercase works for short, punchy lines of up to about four words. Text clips have no uppercase switch, so type the capitals into the text. Give them a little room with `letterSpacing` 0.03 to 0.05 (a share of the font size). Use sentence case for anything longer.
- Lean on size and weight first, and use color second. One accent color for one key word beats a rainbow.

To color a single word, use spans. A span covers the characters from `from` up to, but not including, `to`, counted from 0, and a "\n" counts as one character. In "Fresh bread every Saturday", "Saturday" runs from 18 to 26:

```json
{"op":"update_clip","clipId":"c3","patch":{"spans":[{"from":18,"to":26,"color":"#FFD400"}]}}
```

A span can change color, fontWeight, italic and underline. It can't change size. Spans go in order, can't overlap, and each must change something. Sending spans replaces the whole list, and an empty list removes them. If you later change the text without sending spans, each span stays on its own words.

## Reading time

Work it out as seconds = the larger of 1.5 and (words ÷ 3). Then frames = seconds × the project's fps, rounded up.

| Words | Seconds | Frames at 30 fps | Frames at 24 fps |
|---|---|---|---|
| 1 to 4 | 1.5 | 45 | 36 |
| 6 | 2 | 60 | 48 |
| 9 | 3 | 90 | 72 |
| 12 | 4 | 120 | 96 |

- Past about six words, split the line into two clips. A cooking creator's "Brown the butter until it smells nutty, about 4 minutes" works better as "Brown the butter" followed by "until it smells nutty (4 min)".
- The in and out animations take time from the clip. A 60-frame clip with a 12-frame in and an 8-frame out is fully readable for only 40 frames, so add those frames on top.
- In a Short, the hook starts at frame 0 and has to be readable within 1.5 s. Keep its in animation to 8 frames or fewer.
- To lengthen a clip, move its end. Say a 9-word line starts at frame 45. It needs 90 frames, so its end goes to frame 135:

```json
{"op":"trim_clip","clipId":"c4","edge":"end","to":135}
```

- Text that repeats what someone says should appear when they say it. Caption lines in get_project give the times words are said, so start the text at that line's time. Don't put a title on screen with the same words the captions are already showing.

## Keep it inside the safe area

The safe area is the part of the frame that the apps' buttons, names and descriptions leave uncovered. These are the default boxes:

- short_9x16: clear of the top 14%, the bottom 35% and 6% at each side. That puts y between 0.14 and 0.65 and x between 0.06 and 0.94.
- Every other format: 5% clear on every side.
- If get_project shows a "Safe area" line, someone set this project's box by hand. Use that one. "Safe area 88% wide × 51% tall, centred, from 14% down" means x from 0.06 to 0.94 and y from 0.14 to 0.65.

A clip's y is the center of its whole block of text, so leave room for half the block's height. Each line is 1.2 × the font size tall by default. In a 1920-tall Short, one line of 96 px title is about 6% of the height, so keep its y at 0.17 or more (y grows downward). Two lines need y at 0.2 or more. Near the bottom, a two-line 56 px subtitle needs y at 0.61 or less. A background box adds its padding (0.3 × the font size by default) on every side.

Long text wraps at 90% of the frame's width. In 9:16 that's a little wider than the 88% safe area, so break long lines yourself.

Captions need room too. If the project has captions, get_project shows a "Captions:" line with their y. By default they sit at about y 0.56 in 9:16 and 0.79 in every other format. While someone is talking in a captioned clip, keep other text at least 0.15 of the frame's height away from that y. In 16:9 and 4K the captions are much bigger next to the frame's height, so leave 0.25. In a Short, that usually puts titles between y 0.2 and 0.4:

```json
{"op":"update_clip","clipId":"c2","patch":{"transform":{"y":0.3}}}
```

## Lower thirds and name tags

A name tag tells people who is talking or where they are. The "lower-third" preset is left aligned, and left-aligned lines start 45% of the frame's width to the left of x. At the preset's x of 0.5, the text starts 5% from the left edge. Nudge it in:

- In 16:9, set x to 0.53 so the text starts 8% in, and y to about 0.82. That's the classic spot, as long as no captions are showing then.
- In 9:16, set x to 0.52 so the text starts 7% in. The preset's y of 0.62 sits at the bottom of the safe area, just under the default captions. With a box behind a two-line tag, use y 0.6 so the box stays inside. If captions are on, move the tag up to around y 0.2.
- With captions on in 16:9, put the tag at the top left instead: x 0.53, y 0.13.

Put the name and role in one clip, with a line break, and make the role lighter with a span. Here's a bakery's tag in 16:9 with a soft box behind it:

```json
{"op":"add_clip","trackId":"t2","clip":{"type":"text","start":90,"duration":120,"text":"Rosa Crumb\nHead baker","transform":{"x":0.53,"y":0.82,"scale":1,"rotation":0,"opacity":1,"fit":"contain"},"style":{"fontFamily":"Inter","fontSize":44,"fontWeight":600,"color":"#ffffff","align":"left","backgroundColor":"#000000","backgroundOpacity":0.7},"spans":[{"from":11,"to":21,"fontWeight":400}],"animationIn":{"preset":"slide_right","frames":10},"animationOut":{"preset":"fade","frames":8}}}
```

Show a tag for 3 to 4 s (90 to 120 frames at 30 fps), the first time each person appears. Don't bring it back every time they're on screen. For a soccer club's match recap with three interviews, that's three tags, one per player.

## Contrast: readable over any footage

White text alone gets lost on bright skies, snow, white walls and kitchen counters. You can't see inside the footage, so assume some of it is bright and give text one of these. They run from lightest touch to heaviest, and each shows only once its color is set:

- **Shadow**: `shadowColor`, `shadowBlur`, `shadowX` and `shadowY` in project pixels, plus `shadowOpacity` (0 to 1, 0.6 by default). The editor starts a 96 px title at blur 14 and y 6. That's about 15% and 6% of the font size, and it works at any size.
- **Outline**: `outlineColor` and `outlineWidth`, which is how far in pixels the outline reaches out from the letters. The editor starts at about 8% of the font size: 8 px for 96 px, 4 px for 44 to 56 px. A thick outline, 12% or more, gives the bold sticker look. On thin fonts, outlines look fuzzy, so use a shadow or a box instead.
- **Background box**: `backgroundColor`, `backgroundOpacity` (1 by default, and the editor starts at 0.8 black), `backgroundPadding` and `backgroundRadius` (both shares of the font size, 0.3 and 0.2 by default). This is the best choice for body text, lists and name tags over busy footage.

Style patches merge, so send only the fields you're changing. Setting `shadowColor`, `outlineColor` or `backgroundColor` to null removes that effect, so `{"outlineColor": null}` inside style takes an outline off.

```json
{"op":"update_clip","clipId":"c1","patch":{"style":{"shadowColor":"#000000","shadowBlur":14,"shadowY":6,"shadowOpacity":0.6}}}
```

A box in the business's own colors (ask the person for them) can look cleaner than white on black. Here's a cream box with dark brown text for a bakery's opening-hours line:

```json
{"op":"update_clip","clipId":"c5","patch":{"style":{"color":"#3b2416","backgroundColor":"#fff4e0","backgroundOpacity":0.9,"backgroundPadding":0.35}}}
```

Light text needs a dark shadow, outline or box, and dark text needs a light one. Never leave yellow or pastel text bare over footage you haven't seen.

## Motion: in, out and emphasis

Set these on a text clip with `update_clip`, or put them in the clip when you build it with `add_clip`. Each one is replaced whole, and null removes it.

- `animationIn` presets: "fade", "pop", "slide_up", "slide_down", "slide_left", "slide_right", "typewriter" and "scale_punch". `animationOut` has the same ones except "typewriter" and "scale_punch". A slide names the way the text moves and travels 8% of the frame, so "slide_up" rises into place.
- Lengths at 30 fps: 6 to 12 frames in, 6 to 8 out. Scale these to the project's fps (at 24 fps, 5 to 10 in).
- "typewriter" reveals the characters evenly over its frames. Give it about one frame per character, and use it only for short lines, never a long hook.
- Pick one in animation for each job and stick with it. You might use "pop" for hook lines, "slide_up" for list items and "fade" for anything calm.
- `emphasis` runs for the whole clip: "pulse" grows and shrinks by 5% every 0.8 s, and "shake" jitters. Text that keeps moving looks like a gimmick and is harder to read, so most videos need none. To make a word stand out, give it a span. To light words as they're said, use captions.
- If one line truly needs emphasis, keep it small. `amount` scales how far it moves and `speed` how fast, both 1 when left out: `{"preset":"pulse","amount":0.5}` is a pulse half as big.

A student council's "Vote Thursday" line pops in and fades out, with "Thursday" (characters 5 to 13) in gold:

```json
{"op":"update_clip","clipId":"c6","patch":{"animationIn":{"preset":"pop","frames":8},"animationOut":{"preset":"fade","frames":6},"spans":[{"from":5,"to":13,"color":"#FFD400"}]}}
```

Use emphasis on one line in a video at most, and never on body text. For more on motion, read the transitions-and-motion topic.

## Common mistakes

- Preset sizes left as they are in a 4K project, where text comes out half the size it would be at 1920 wide.
- Text in the bottom 35% of a Short, where the app's buttons and the post's description cover it.
- A title or name tag on top of the captions, or a title that repeats the words the captions show.
- Too much to read: three lines of body text up for 2 s, or a 12-word hook with a typewriter in.
- Fonts that drift away from the brand kit, or three fonts and four colors in one video.
- White text with no shadow, outline or box over footage you haven't seen.
- A left-aligned name tag left at x 0.5, so it starts right at the frame's edge.
- A video or overlay track added with `add_track` and no index. It goes last, draws on top and hides the text, so give it an index below the text tracks.
- Animations that use up the reading time, or emphasis on more than one line.
