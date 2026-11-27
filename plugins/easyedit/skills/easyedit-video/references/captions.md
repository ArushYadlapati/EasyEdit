# Captions people read

Read this when you turn captions on, pick or change their look, place them in the frame, or fix words the captions got wrong.

## The short version

- In a short (9:16), turn captions on for every clip where someone talks. A lot of people watch with the sound off.
- Turn them on per clip with `update_clip` and `"captions": true`. If the file has no saved words, ask the person to press Auto captions in the Captions tab. Never type the words yourself.
- Pick one look for the whole project with `set_caption_style`: karaoke for most talking videos, block for calm ones, word for short loud ones, bar for wide frames and busy footage.
- Keep captions inside the safe area. On 9:16 that means y between about 0.2 and 0.6. The default, 0.558, is a good spot.
- Each look keeps lines short for you (28 characters, or 42 for bar). Your job is the size: two rows at most, and a little smaller in ALL CAPS.
- Only karaoke shows the highlight color. Make it bright and clearly different from the white words.
- Fix misheard names, numbers and words with `splice_caption_words`. Keep what the person said. Don't rewrite it.
- Captions draw at their track's place in the stack. Keep the Captions track last so nothing covers them.
- If the space has a saved style, follow its captions settings before your own taste, unless the person asks for something else.

## When captions go on

Captions show the words heard in a clip's own sound. In the editor each captioned clip has one caption clip on the Captions track (type `"caption"`, with the clip's `assetId`), linked with it so they move together. A caption clip shows only the lines whose words start inside it, so splitting it, trimming it or removing a piece changes where captions show. The project has one Captions track that draws them all.

- **Shorts, Reels and TikToks:** on, for every clip where someone speaks. Once a project has captions, keep them on for all its talking clips, not just some.
- **Long-form YouTube (16:9):** a choice. Captions drawn into the picture help a tutorial or a fast talker. Many long videos skip them and post a subtitle file instead, which viewers can switch off. The person can download a .srt or .vtt under Subtitle files in the Captions tab. If you can't tell which they want, ask.
- **Music only, or nobody talking:** leave captions off. For a band's video, ask before captioning lyrics.
- **Voiceover over b-roll:** caption the voiceover clip, not the b-roll. The b-roll's own sound can hold stray chatter that would turn into captions.

Turn them on for the clips that talk, in one batch:

```json
[
  {"op":"update_clip","clipId":"c1","patch":{"captions":true}},
  {"op":"update_clip","clipId":"c4","patch":{"captions":true}}
]
```

This works when the file already has saved captions, and it adds the Captions track if the project has none. If the result says a file has no saved captions, tell the person what to do: open the project, select the talking clips, choose the Spoken language, and press Auto captions in the Captions tab. Then try again. With nothing selected it captions every clip with sound, b-roll included, so say which clips to select. A cooking creator who films in Spanish but posts in English can turn on Translate to English there. People can also bring in a .srt or .vtt for a selected clip with Import subtitles.

Captions follow their clip. Trim it and the cut words go. Move it, split it or change its speed and the lines move with it. A clip that plays backward or holds one frame has no captions. Never try to place caption lines by hand.

Turning captions on with `update_clip` gives the clip its caption clip the next time someone opens the project in the editor. To turn one clip's captions off, remove its caption clips with `remove_clip` (their ids are under the Captions track in get_project), and patch the clip with `"captions": false` if it has the switch on. To show captions for only part of a clip, `split_clip` its caption clip and remove the piece you don't want. To hide every caption at once, hide the Captions track (its id is in get_project):

```json
{"op":"update_track","trackId":"cap1","patch":{"hidden":true}}
```

## Pick a look

One style covers every caption in the project. These are the four looks. The editor calls them Block, Karaoke, One word and Bar.

- **karaoke** (the default): white words with a black outline, and the word being spoken lit in the highlight color. The best fit for most talking shorts: a cooking creator walking through a recipe, a bike shop owner showing a brake fix. Eyes follow the lit word. Lines in a right-to-left language (Arabic, Hebrew) show no lit word.
- **block**: the same lines with no lit word. Calmer. Good for a study channel, an interview, or a student council update, where a moving color would distract.
- **word**: one word at a time, drawn 1.3 times the font size, popping in over 3 frames. Loud and quick: a soccer club's goal of the week, a 15-second promo. It gets tiring past about 30 seconds, and it flickers when someone talks faster than about 180 words a minute.
- **bar**: lines on a dark rounded box, with no outline, up to 42 characters a line. It reads on any background, so it suits bright or busy footage (snow, a white kitchen, a crowd) and wide 16:9 frames. On 9:16 its long lines reach close to the sides, so prefer the other looks there.

A calm explainer for a study channel:

```json
{"op":"set_caption_style","patch":{"preset":"block","fontFamily":"Inter","fontWeight":600,"fontSize":64}}
```

A goal recap for Puddle Lane FC:

```json
{"op":"set_caption_style","patch":{"preset":"word","fontFamily":"Anton","fontWeight":400,"fontSize":64,"uppercase":true,"y":0.45}}
```

The fields are preset, fontFamily, fontWeight (a weight the font has, 300 to 900), fontSize (px), color and highlight (hex like #FFD400), y (0 to 1, a share of the frame's height) and uppercase. A patch changes only the fields you give. `{"op":"set_caption_style","clear":true}` goes back to the default look. get_project shows the current style on its "Captions:" line.

Pick a font that reads at a glance: Geist (the default), Inter, Montserrat, Poppins, DM Sans or Rubik. For ALL CAPS, a condensed font such as Oswald, Barlow Condensed, Anton or Bebas Neue fits more on a row. Anton, Bebas Neue and Archivo Black only come in weight 400, so set fontWeight 400 with them. Bebas Neue has only capital letters, so it reads as ALL CAPS either way. Skip script fonts like Pacifico, Lobster and Caveat for captions.

When the person presses Auto captions in a project with no caption style yet, the style starts in the brand kit's title font. Turning captions on with update_clip sets no style, so with none saved they start in Geist. If the project's titles use a readable sans (get_project shows each text clip's font), you can match it with set_caption_style.

## Line length, size and ALL CAPS

You don't set line length directly. Each look breaks speech into lines for you:

- block and karaoke hold up to 28 characters a line, bar up to 42, and word one word.
- A pause longer than 0.6 seconds starts a new line (18 frames at 30 fps; the project's first line gives its fps). So does the end of a sentence: a word ending in a period, question mark or exclamation point.
- A line stays up 0.4 seconds (12 frames at 30 fps) after its last word, unless the next line or the end of the clip comes first.
- A line wraps onto a second row when it is wider than 80% of the frame (90% for bar).

So what you control is the size. The default is 6.5% of the frame's width: 70 px on a 1080-wide frame, 125 px on 1920×1080, 250 px on 4K. On 9:16 at 70 px, a full 28-character line wraps to two rows. That's fine, and two rows is the most you want. Around 56 px, most lines fit on one row.

- On a 1080-wide frame (9:16, 4:5, 1:1), use 56 to 80 px. Don't go below about 48 px. People read these on phones.
- On 16:9, 64 to 80 px reads well and keeps most lines to one row. The default 125 px gives big, Shorts-style captions, which can be right for a loud vlog but heavy for a calm tutorial. On long_4k, double these numbers.
- The word look draws 1.3 times bigger, so its fontSize can sit a little lower: 64 draws at about 83 px.

If a line breaks in an awkward place, you can end it with punctuation using `splice_caption_words`: a word ending in a period ends its line. Only do this where the punctuation is right anyway.

Set `"uppercase": true` to draw every caption in capitals. The words stay as typed, so fixes still use normal case.

- Caps feel loud and sporty. They suit hype edits, a soccer club, a gym, a band's tour promo.
- Caps are harder to read in long runs. For a 10-minute tutorial or a calm study video, keep sentence case.
- Caps run about a fifth wider. Take fontSize down about 10 px on a 1080-wide frame, or use a condensed font, so lines don't spill onto more rows.

```json
{"op":"set_caption_style","patch":{"preset":"karaoke","uppercase":true,"fontSize":60}}
```

## Place them in the safe area

y is where the middle of the caption lines sits, as a share of the frame's height. Captions are always centered sideways. Keep the whole block, with room for two rows, inside the safe area: the box the apps' buttons, usernames and descriptions leave uncovered.

| Format | Default y | Keep y between | Upper | Middle | Lower |
|---|---|---|---|---|---|
| short_9x16 | 0.558 | 0.2 and 0.6 | 0.25 | 0.45 | 0.558 |
| feed_4x5, square_1x1, long_16x9, long_4k, custom | 0.788 | 0.2 and 0.8 | 0.2 | 0.5 | 0.788 |

- On 9:16, the bottom 35% is where TikTok, Reels and Shorts put the username, description and buttons. Captions lower than about y 0.6 get covered.
- If get_project shows a "Safe area" line, the project has its own size. Work from that box instead.
- When two captioned clips play at the same moment, their lines stack upward from y. Leave room above.
- Keep titles and captions apart. A title near the top of a short (y 0.25 to 0.35) and captions at 0.558 sit well together. If both must be low, move the title up rather than stacking them, and keep about 10% of the frame's height between them. With captions upper, put the title lower or leave it out.
- You can't see the footage. If the person says captions cover a face or the product, move y.

Moving a title clip up and out of the captions' way:

```json
{"op":"update_clip","clipId":"c9","patch":{"transform":{"y":0.3}}}
```

A saved caption style keeps its numbers. If you change the format with set_format, the fontSize and y that suited the old frame stay. Check the "Captions:" line afterward and set fontSize and y for the new frame. Clearing the style also gives the new frame's default, but it drops the font too, so set the font again if they had one.

Captions draw at their track's place in the stack: over the tracks listed before the Captions track in get_project, under the ones after it. The Captions track starts last. A track you add with add_track and no index goes after it, and so does a first overlay track added in the editor for a picture-in-picture. Either one covers the captions. Give add_track the Captions track's index so the new track goes just before it, or move the Captions track back to the end. index is the number of tracks minus 1, here in a project with six tracks:

```json
{"op":"move_track","trackId":"cap1","index":5}
```

## Color and the highlight

- color is the words. Keep it white (#ffffff) or very light. The black outline (block, karaoke, word) or the dark box (bar) does the rest.
- highlight is the lit word, and only karaoke shows it. The default is #FFD400, a warm yellow. Setting it on block, word or bar changes nothing you can see.
- Pick a highlight that is bright and clearly different from the words: yellow, lime (#A3E635), cyan (#22D3EE) or hot pink (#FF4FD8). A dark color like navy or deep red disappears into the black outline.
- A brand color makes a good highlight when it is bright. For a bakery with a warm orange brand, try #FF8A3D. If the brand color is dark, use it elsewhere and keep a bright highlight.

```json
{"op":"set_caption_style","patch":{"preset":"karaoke","color":"#ffffff","highlight":"#22D3EE"}}
```

## Fix the words

Auto captions mishear names, numbers and quiet words. get_project lists every line under the Captions track:

```text
Track cap1 [caption] "Captions"
  0.00–1.60s  "Hi I'm Dana from moon crime"  clip=c1 asset="a1" words=0-5
  1.60–3.30s  "bakery and today we bake for"  clip=c1 asset="a1" words=6-11
  3.30–4.47s  "loaves of rye."  clip=c1 asset="a1" words=12-14
```

words=first-last are the places of the line's words in the file's word list, counting from 0. Here "moon crime bakery" should be "Moon Crumb Bakery" (places 4 to 6, across two lines), and "for" should be "four" (place 11):

```json
[
  {"op":"splice_caption_words","assetId":"a1","index":11,"remove":1,"text":"four"},
  {"op":"splice_caption_words","assetId":"a1","index":4,"remove":3,"text":"Moon Crumb Bakery"}
]
```

- index is the first word to replace, and remove is how many (last minus first plus 1 for a whole line). text is what was really said. The new words take the old ones' times, shared out by length when the count changes.
- Put fixes in order from the highest index to the lowest. A fix that changes the number of words shifts every place after it.
- Empty text removes the words. You can drop an "um" from the captions that way, but the sound still has it. To cut it from the sound, trim or split the clip.
- Words belong to the file, so a fix shows in every clip of this project cut from that file.
- Fix what was misheard: names, brand names, numbers, technical words. Digits read faster than spelled-out numbers ("3 tips", "$12"). Keep the person's own words and grammar. Don't shorten, polish or add words they didn't say.
- If you can't tell what was said, ask. You can't hear the footage.
- Leave set_transcript alone. It replaces a file's whole word list, and that comes from Auto captions.

## Follow the space's style

When you read the guide with the project's space (`get_editing_guide` with space), it may end with "## This space's style". Its captions line reads like "Captions: on, One word look (preset word), all caps, near the top of the frame." Follow it:

- on true: captions on for every talking clip. on false: leave them off unless the person asks.
- The preset in brackets is the look, and "all caps" means uppercase true. "Near the top", "in the middle" and "near the bottom" are the positions upper, middle and lower: use the y values in the table above. Lower is where the editor puts captions before anyone moves them.
- No captions field? Past projects listed as references name the caption look they used. Follow that.
- `get_editing_guide` with topic "style" and the space gives frame sheets from their videos, where your client can show images. Look at how big their captions are and where they sit, and match the closest look.
- Reference videos list words a minute. For a fast talker (over about 180), karaoke or block works better than word.
- If the person gives you a caption rule that should stick ("always one word at a time, in caps"), offer to save it. With their OK, and if they are an editor or admin, call `save_style` with the space and fields `{"captions":{"on":true,"look":"word","uppercase":true}}`. Save only what they said. The captions field is saved whole, so carry over a position that was already saved. They can also change it themselves under Settings → Style.

## Common mistakes

- Typing captions yourself, in text clips or with set_transcript. Turn captions on and let Auto captions hear the words.
- Captioning both a video clip and an audio clip made from the same file. Every line shows twice, stacked. Captions still show on muted or hidden tracks and at volume 0, so turn them off on the copy.
- Setting highlight on block, word or bar and expecting a change. Only karaoke lights a word.
- Putting captions in the bottom 35% of a 9:16 frame, where the apps' text and buttons sit.
- Making captions so big, often in ALL CAPS, that lines run to three rows.
- Rewriting what someone said while fixing captions.
- Leaving a 9:16 caption style in place after switching the project to 16:9.
- Adding an overlay track after the Captions track, so a picture-in-picture covers the words.
- Unlocking a locked Captions track to make a change. A locked track holds the style and words still on purpose, so ask first.
