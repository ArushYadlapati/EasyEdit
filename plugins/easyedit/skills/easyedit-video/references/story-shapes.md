# Story shapes

Read this when you plan a video's structure: which beats go where and for how long, in a 30-second short or a long YouTube video with chapters.

## The short version

- For a short, pick one shape before you place a clip: recap, how-to, reveal, talking head, vlog, promo, event, before/after or list. Don't mix two.
- Every shape has three parts: a hook (2 to 3 seconds), a middle that delivers, and an ending that lands. Plan the ending first.
- Lay clips in story order, not the order the files were shot. Vlogs, events and a recap's highlights follow the clock, but even they open on the best moment.
- The payoff beat gets the longest shot. Everything before it can be quick.
- To change the length, keep the hook and the ending and flex the middle: fewer steps or items, not faster ones.
- Read the space's style first. Its length, pace and always/never lists beat the timings here.
- You can't watch the footage. Find the key moment (the peak, the result, the reveal) from names, events, lengths and caption lines, or ask.
- Say which shape you're using in one line, then build it. The person can fix details on the timeline.

The tables below are for a 30-second short at 30 fps, which is 900 frames. Ops take whole frames, so multiply seconds by the fps on the first line of `get_project`: 2 seconds is 60 frames at 30 fps, 48 at 24 and 120 at 60.

## Plan the beats

A beat is one job the video does: hook, context, step, proof, payoff, ending. Write the beats down with their frame ranges before you touch the timeline. It takes a minute and saves a rebuild.

1. **Pick the shape** from what they asked for and what footage they have. `list_assets` names and events often tell you: "final-whistle.mp4" and "warmup.mp4" say recap; "step1-dough.mov" says how-to.
2. **Find the key moment.** Every shape hangs on one: the winning goal, the finished dish, the restored bike. If you can't tell which file holds it, ask: "Which clip is the moment you want people to remember?"
3. **Fit the length.** Keep the first 2 seconds and the last 3, and change the middle. At 15 seconds a how-to has two steps, not three rushed ones. At 60 seconds a list has five items, not three slow ones.
4. **Match the style.** Call `get_editing_guide` with the project's space. If it ends with "## This space's style":
   - lengthSeconds is the range the total should land in, and formats lists the frame shapes they post in.
   - pace and shotSeconds set how many shots fit in the middle. Divide the middle by shotSeconds: the recap's 17-second middle below holds about 17 shots at 1 second a shot, and four at 4 seconds.
   - hook says how they open. Use it for the first beat, even when the shape says otherwise.
   - text "none" means no titles or labels beyond captions, so ask before you add the ones below. transitions "cuts" means plain cuts where this file suggests a whip or a dip.
   - always and never may hold structure rules, like "always end on the score".
   - A past project in their references shows its length, shots and text clips a minute. If it's the same kind of video, copy its rhythm.

When the person tells you a structure they always use ("we end every recap on the next match date"), offer to save it with `save_style`: their space, and `fields.always` with the lines already there plus the new one (eight at most), since it replaces the whole list. Saving needs an editor or admin and changes what every agent in the space reads, so ask first.

## Build it in EasyEdit

- **Check templates first.** `list_templates` shows the starters and the space's saved templates. If one already has your shape, start with `create_project` and that template, then `fill_template`. The Match Recap starter is a 30-second 9:16 recap: hero_clip 0 to 8 s, highlights 8 to 24 s, final_moment 24 to 30 s. A template's own notes beat these tables.
- **Lay the picture in one call.** `add_media` with the items in beat order, each with asset_id, in_seconds (where the good part starts) and duration_seconds. It lays them end to end, so the beats land where you planned. It takes up to 20 items a call, so a fast cut may need two.
- **Add the text in one call.** `add_text` with one item per beat that needs words, each with a preset, start_seconds and duration_seconds. Keep each line up at least 1.5 seconds.
- **Refine with `edit_timeline`.** Trims, transitions at beat changes that mean something, a speed change. Pass the version from your last result as expected_version each time.
- **Check it.** `get_project` lists every clip's start in seconds and frames. Make sure the total length is right and the payoff starts where you planned. Then tell the person the shape and give the editor link.

## Shapes that show what happened

**Recap or highlight.** A soccer club's match. The result comes first, then the story that got there.

| Time | Frames (30 fps) | Beat |
| --- | --- | --- |
| 0–2 s | 0–60 | The peak, briefly: the winning goal, with the score as text |
| 2–5 s | 60–150 | Context: who played, where. One line of text |
| 5–22 s | 150–660 | 6 to 9 highlights in match order, 1.5 to 3 s each, building |
| 22–27 s | 660–810 | The peak again, in full, or the team celebrating |
| 27–30 s | 810–900 | End card: final score and the next match date |

**Event.** A student council's spring formal. Like a recap, but about who was there, not who won.

| Time | Frames (30 fps) | Beat |
| --- | --- | --- |
| 0–2 s | 0–60 | The biggest moment: the dance floor full, confetti, the crowd |
| 2–5 s | 60–150 | What and when: "Spring Formal 2026" |
| 5–23 s | 150–690 | Setup, arrivals, the main moment, details, faces. Mix wide and close shots, 1.5 to 2.5 s each |
| 23–27 s | 690–810 | The group photo or the last song, held longer |
| 27–30 s | 810–900 | Thanks to the people who helped, and the next event |

Put faces in the middle. People share event videos they appear in.

**Day-in-the-life vlog.** A flower shop on Valentine's Day. This one follows the clock, but still opens on the best moment.

| Time | Frames (30 fps) | Beat |
| --- | --- | --- |
| 0–2 s | 0–60 | The best moment of the day, with "Our busiest day of the year" |
| 2–5 s | 60–150 | The start: keys in the door, buckets of roses, "6:00 AM" |
| 5–25 s | 150–750 | 7 to 10 moments in time order, 2 to 3 s each |
| 25–30 s | 750–900 | The wind-down: lights off, one quiet last line |

Mark the time of day with a small label at each new part of the day: `add_text` with preset "lower-third", 1.5 to 2 seconds each. If the video has captions, move the labels up out of their way (see the on-screen text topic).

## Shapes that teach

**How-to or tutorial.** A cooking creator's one-pan gnocchi. Show the result first so people know it's worth it.

| Time | Frames (30 fps) | Beat |
| --- | --- | --- |
| 0–2 s | 0–60 | The finished dish and the promise: "Gnocchi in one pan" |
| 2–5 s | 60–150 | What you need, laid out, with a short list as text |
| 5–12 s | 150–360 | Step 1, with "1. Brown the gnocchi" |
| 12–19 s | 360–570 | Step 2 |
| 19–26 s | 570–780 | Step 3 |
| 26–30 s | 780–900 | The result again, being eaten, and one tip |

Cut the waiting out of every step: the stirring, the oven timer. Show the start of the action and the result of it.

**Top-N list.** A guitarist from a band, "3 pedals I can't play without". Number every item on screen.

| Time | Frames (30 fps) | Beat |
| --- | --- | --- |
| 0–2 s | 0–60 | The promise, with a glimpse of the best item |
| 2–10 s | 60–300 | #3: number and name for 1.5 to 2 s, then show it |
| 10–18 s | 300–540 | #2 |
| 18–27 s | 540–810 | #1, the best, a little longer |
| 27–30 s | 810–900 | A question back: "Which one would you try?" |

Count down so the best comes last, but show a bit of it in the hook so people stay. Three items fit 30 seconds; five need 45 to 60. Put each label up with `add_text` at the item's start, preset "title" and duration_seconds 2. Then move it to about y 0.3 with `update_clip`, so it covers neither the item nor the captions.

**Talking head with b-roll.** A study channel explaining spaced repetition. The face makes the points; b-roll proves them.

| Time | Frames (30 fps) | Beat |
| --- | --- | --- |
| 0–3 s | 0–90 | Face: the claim, with hook text |
| 3–8 s | 90–240 | Why it matters. First b-roll at about 4 s |
| 8–24 s | 240–720 | Three points, about 5 s each: the face says it, b-roll shows it |
| 24–28 s | 720–840 | Face: the one thing to remember |
| 28–30 s | 840–900 | Face: a short ask |

Keep the face on screen for the hook, the main point and the ending, about 40% of the time. The b-roll goes on an overlay track over the talking clip, so the voice keeps running (see the b-roll topic). If the talking clip has captions on, its caption lines in `get_project` show when each point starts.

## Shapes that build to a payoff

**Reveal.** An art club's finished mural. This is the one shape that holds back its best moment, so the hook promises it instead of showing it.

| Time | Frames (30 fps) | Beat |
| --- | --- | --- |
| 0–3 s | 0–90 | The tease: a close-up detail and "40 hours, one wall" |
| 3–18 s | 90–540 | The build: the process, shots getting shorter, from 3 s to 1 s |
| 18–19 s | 540–570 | A breath: hands stepping back, a short pause |
| 19–26 s | 570–780 | The reveal: the whole thing, the longest shot in the video |
| 26–30 s | 780–900 | Reactions, and where people can see it |

Frame 0 still needs a real picture and the hook text. Mark the reveal with one or two touches, not five. If there's music, land the reveal on a beat or the drop. Here c7 is the reveal shot, with a quick whip into it, and c12 is its text, with a pop:

```json
[
  {"op":"update_clip","clipId":"c7","patch":{"transitionIn":{"kind":"whip","frames":6,"direction":"left"}}},
  {"op":"update_clip","clipId":"c12","patch":{"animationIn":{"preset":"pop","frames":10}}}
]
```

**Before/after.** A bike shop restoring a rusty bike. The change is the story, so make it easy to see.

| Time | Frames (30 fps) | Beat |
| --- | --- | --- |
| 0–2 s | 0–60 | The before, with the promise: "Found in a barn. Watch this." |
| 2–6 s | 60–180 | The before, slow enough to see the rust and the flat tires |
| 6–19 s | 180–570 | The work, fast: shots of about 1 s, or sped up |
| 19–27 s | 570–810 | The after, from the same angle as the before, held |
| 27–30 s | 810–900 | The number (hours, cost) and an ask |

Ask for the before and after shots from the same angle. It's what makes the change readable. To speed up the work, raise a clip's speed. At 4, a 2-second clip shows 8 seconds of footage, so the file needs that much after the clip's in point, or the change is refused. Sped-up sound is rarely worth hearing, so turn it off and let the music carry it:

```json
{"op":"update_clip","clipId":"c5","patch":{"speed":4,"volume":0}}
```

For the switch, wipe the after over the before. Put the after shot on an overlay track just above the main video (if there isn't one, add it with `add_track` and an `index`; see the b-roll topic). Then key its left crop from 0.95, the most a crop keyframe can cut, down to 0. Here the before clip on "v1" runs to at least frame 590, and the after sweeps in from the right over 20 frames at 19 seconds and holds to 27:

```json
{"op":"add_clip","trackId":"o1","clip":{"type":"video","assetId":"a9","start":570,"duration":240,"in":0,"speed":1,"volume":0,"transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"cover"},"keyframes":{"cropLeft":[{"at":0,"value":0.95,"ease":"ease_in_out"},{"at":20,"value":0}]}}}
```

A plain cut on a music beat works too. Either way, hold the after at least 4 seconds.

## A shape that sells: promo or product

A bakery's new maple croissant. Lead with the product, end with what to do about it.

| Time | Frames (30 fps) | Beat |
| --- | --- | --- |
| 0–2 s | 0–60 | The product at its best, with its name or the offer |
| 2–7 s | 60–210 | Who it's for or what it fixes: the Friday morning treat |
| 7–19 s | 210–570 | Three details, about 4 s each: the layers, the glaze, the first bite |
| 19–25 s | 570–750 | Proof: the line out the door, a customer's face, "Sold out by 10" |
| 25–30 s | 750–900 | The offer: what, when, where. "Fridays only. Order ahead." |

Keep the offer on screen for the whole last beat, at least 3 seconds, inside the safe area. One offer per video. Keep the end card in the brand kit fonts `add_text` gives you, and in the brand's colors if you know them.

## Long-form YouTube

A gardening channel's 10-minute "Start a balcony garden", in long_16x9. A long video is several short shapes in a row, each one a chapter.

| Time | Frames (30 fps) | Beat |
| --- | --- | --- |
| 0:00–0:30 | 0–900 | Cold open: show the payoff (the full balcony) and say the promise. No logo first |
| 0:30–0:40 | 900–1200 | Title or a short intro, 10 s at most |
| 0:40–2:30 | 1200–4500 | Chapter 1: Pick your spot |
| 2:30–5:00 | 4500–9000 | Chapter 2: Pots and soil |
| 5:00–7:30 | 9000–13500 | Chapter 3: What to plant. Around the middle, re-hook: "This is the part I got wrong" |
| 7:30–9:20 | 13500–16800 | Chapter 4: Six weeks later, the payoff |
| 9:20–10:00 | 16800–18000 | Wrap: one-line recap, the next video. Keep the last 20 s calm for end-screen cards |

Inside a chapter, change something every 5 to 10 seconds: a new angle, b-roll, a text callout. Each chapter is its own small how-to or before/after.

**Chapters.** YouTube makes chapters from timestamps in the description. The first must be 0:00, they must run in order, there must be at least three, and each must last at least 10 seconds. Name each one by what's in it ("Pots and soil", not "Part 2").

- If the person has dropped markers in the editor (B adds one at the playhead), `get_project` shows a "Markers:" line with each marker's time and name. Use those as the chapter list.
- Otherwise, take each chapter's start from the start of its first clip in `get_project`.
- Put a chapter title on screen at each start: `add_text` with preset "lower-third" for 2 to 3 seconds, then place it as the on-screen text topic says for 16:9.
- Give the person the list, ready to paste, with times rounded down to whole seconds: "0:00 Intro", "0:40 Pick your spot", "2:30 Pots and soil".

A dip marks a chapter change well. Use it at chapter starts only, not between every shot:

```json
{"op":"update_clip","clipId":"c21","patch":{"transitionIn":{"kind":"dip","frames":12,"color":"#000000"}}}
```

## Common mistakes

- Treating the tables as rules. They're starting points. The footage and the space's style move the beats.
- Laying clips in the order they were filmed. Only vlogs, events and a recap's highlights follow the clock, and even they open on the best moment.
- No real ending. The last 3 seconds trail off instead of landing on a score, a result or an offer.
- Every beat the same length. The payoff needs the longest shot, and the build before it can be quick.
- Showing the reveal in the hook, or burying the payoff of any other shape past second 20.
- Too many list items or steps for the length. Five items in 30 seconds means none is readable. Cut items, or make it longer.
- Before and after from different angles, or cutting away from the after in under 4 seconds.
- Long-form chapters YouTube won't read: no 0:00, fewer than three, or one under 10 seconds.
