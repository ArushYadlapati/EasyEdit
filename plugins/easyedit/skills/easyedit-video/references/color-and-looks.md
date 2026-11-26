# Color and looks

Read this when you change how footage looks: matching clips to each other, adding a look like Warm or Moody, fixing skin tones, or following a space's saved look.

## The short version

- You can't see the footage, so grade gently. Say exactly what you set, and ask the person to check faces and the darkest clips in the editor.
- Match first, then style. Fix the one or two clips that stand out with small `adjust` changes on those clips. Then put one look over the whole video.
- Put a whole-video look on an adjustment layer: one "adjustment" clip on its own overlay track, right above the footage and below text, captions and shapes.
- A look is a set of adjust numbers. For a strength, multiply each number. Always send all six look keys (brightness, contrast, saturation, temperature, hue, vignette) so nothing from an old look stays behind.
- Keep numbers small. Corrections run 0.05 to 0.15. Looks go on at 50% to 100% strength.
- Protect skin. With faces on screen, keep the total saturation at +0.3 or less and temperature between -0.15 and +0.35.
- Follow the space's style. Call `get_editing_guide` with the space. Look "natural" means no look, and a look id means that look on one layer.
- One look per video. Add a second only to mark a real change, like a flashback in B&W.

## Match the clips first

Viewers barely notice a look. They do notice when one shot is bluer or darker than the shot before it. That jump reads as a mistake. So your first job is to make the clips match each other. Only then give them a look.

These clips need the most care:

- Footage from two phones or cameras. One is often warmer than the other.
- Indoor next to outdoor. Bulbs make indoor light orange, tube lights make it green, and daylight is bluer than both.
- Stock next to phone footage. Stock is often more polished, with more contrast and stronger color (stock itself is in `get_editing_guide` with topic "b-roll").
- A shot from another time of day, like a sunset clip in a midday recap.

Clips from the same phone, in the same place, in the same hour usually match already. Leave those alone.

You can't see the clips, so find the odd ones another way:

- Ask. "Do any shots look darker, bluer or more orange than the rest?" Name clips by their time so the person can answer quickly.
- Read names and events from `list_assets`. A file called "gym_tube_lights" or "pier_sunset" tells you a lot.
- Pick an anchor: the clip people see most, usually the face talking to camera. Match the others to it, not the other way around.

Fix each odd clip on the clip itself, with small numbers. The Fernbrook Foxes under-12s recap has one clip from the indoor hall (c3). Under the hall's cool white lights it's dark and a little blue next to the sunny match footage:

```json
{"op":"update_clip","clipId":"c3","patch":{"adjust":{"brightness":0.1,"temperature":0.12}}}
```

Don't make night look like day, or a gray morning look sunny. Lifting a dark clip far also brings up its grain. Clips can show different times and still match: the same skin, the same strength of color, and no shot that jumps out.

## The adjust fields

Video and image clips, adjustment layers and nests take `adjust` through an `update_clip` op. Every field is 0 when the picture is as recorded. Text, shapes and audio don't take it. A text clip's color lives in its style.

| field | range | what it does | gentle | a clear mood |
| --- | --- | --- | --- | --- |
| brightness | -1 to 1 | Multiplies the light: 0.1 is 10% brighter. Past +0.2, skies and white shirts lose detail. | ±0.05 to 0.15 | rarely needed |
| contrast | -1 to 1 | Above 0, deeper shadows and brighter highlights. Below 0, flatter and milky. | ±0.05 to 0.1 | +0.2 to 0.35, or -0.1 to -0.2 |
| saturation | -1 to 1 | How strong the colors are. -1 is black and white. | ±0.05 to 0.15 | +0.25 to 0.4, or -0.3 for muted |
| temperature | -1 to 1 | Below 0 is cooler (bluer), above 0 is warmer (more orange). | ±0.05 to 0.15 | ±0.3 to 0.5 |
| hue | -180 to 180 | Turns every color around the wheel, in degrees. Skin turns too. | leave at 0 | Dusk uses -12 |
| vignette | 0 to 1 | Darkens the corners. | 0.15 to 0.25 | 0.3 to 0.5 |

Temperature works by taking light away. Warming takes out blue and a little green, and cooling takes out red and a little green. So a strong shift also darkens the picture a little. Past about 0.4, add brightness 0.03 to 0.05 to make up for it. The Golden look does exactly that.

adjust merges one level deep. Keys you send change, and keys you leave out keep their values. To take one change off, send it as 0. To put a clip back to as recorded, send brightness, contrast, saturation, temperature, hue, blur and vignette, all at 0.

The same field also holds blur and the stylized effects (sharpen, grain, pixelate, split, glitch, vhs). They aren't color, and no look touches them. Leave them alone unless you're asked.

`get_project` shows what's set on each clip, like adjust={"brightness":0.1,"temperature":0.12}. Read it before you change anything, so you build on what's there.

## Looks and their strength

A look is a ready-made set of the same numbers. In the editor, the looks are buttons in a clip's Color section. There's no look op. You apply a look by writing its numbers into adjust.

| id | editor label | what it sets at full strength | good for |
| --- | --- | --- | --- |
| "vivid" | Vivid | contrast 0.15, saturation 0.35 | daylight sports, products, travel |
| "pop" | Pop | brightness 0.03, contrast 0.25, saturation 0.6 | loud, playful Shorts with few faces |
| "warm" | Warm | temperature 0.35, saturation 0.1 | food, cozy rooms, family events |
| "golden" | Golden | brightness 0.05, contrast 0.05, saturation 0.2, temperature 0.5 | golden hour, bakeries, weddings |
| "cool" | Cool | temperature -0.35, saturation 0.05 | clean tech, winter, swimming |
| "dusk" | Dusk | contrast 0.1, saturation 0.15, temperature -0.2, hue -12, vignette 0.25 | evenings, city lights, calm music |
| "soft" | Soft | brightness 0.06, contrast -0.12, saturation 0.1, temperature 0.1 | gentle vlogs, beauty, crafts |
| "fade" | Fade | brightness 0.08, contrast -0.2, saturation -0.15 | washed-out, nostalgic "aesthetic" edits |
| "vintage" | Vintage | contrast -0.1, saturation -0.25, temperature 0.3, vignette 0.45 | throwbacks, anniversaries |
| "moody" | Moody | brightness -0.1, contrast 0.2, saturation -0.3, temperature -0.15, vignette 0.3 | serious stories, rain, night |
| "drama" | Drama | brightness -0.05, contrast 0.35, saturation -0.1, vignette 0.35 | trailers, big moments, game day |
| "mono" | B&W | contrast 0.15, saturation -1 | flashbacks, timeless portraits |
| "noir" | Noir | brightness -0.05, contrast 0.45, saturation -1, vignette 0.5 | mystery, heavy drama |
| "sepia" | Sepia | contrast 0.05, saturation -1, temperature 0.55 | old photos, history pieces |

A space's style names a look by its id, so B&W is "mono" there.

To use a look at a strength, multiply each of its numbers by the strength and round to 4 decimal places. Send all six look keys, with 0 for the ones the look doesn't set. A cooking creator wants only the plated-dish shot (c7) warmer. That's Warm at 60%:

```json
{"op":"update_clip","clipId":"c7","patch":{"adjust":{"brightness":0,"contrast":0,"saturation":0.06,"temperature":0.21,"hue":0,"vignette":0}}}
```

When the six numbers are exactly one share of a look, the editor lights that look's button and shows Look strength as a percent, so the person can drag it. Change any one of them by hand and it becomes a custom setting. That's one more reason to keep fixes on the clips and the look on a layer.

How strong to go:

- 100% is the look as it was designed. On everyday phone footage, 60% to 80% is often right.
- Pop (saturation 0.6) and Noir (contrast 0.45) are loud. Start Pop at about 50% when people are on screen.
- Use B&W, Noir and Sepia at full strength. At 50%, B&W is just a muted color picture, and it looks like a mistake.
- Choose by the mood the person describes, not by the subject. A bakery's cozy morning is Warm or Golden. The same bakery's late-night "how we make it" video could be Moody.

## One look over everything: adjustment layers

An adjustment layer is a clip with no picture of its own. While it runs, it changes everything on the tracks under it, with the same adjust, grade and mask a video clip takes. Use one whenever a look should cover the whole video. You set it once, change it in one place, and the person can switch it off to compare.

Where it goes matters. Tracks draw in order, and the layer changes only the tracks before its own. Put it right after the last track with footage or photos, and before text, captions, shapes and any logo. Then titles and brand colors stay exactly as they were set. `get_project` lists the tracks in draw order, so count from the top of that list, starting at 0. In a new project (v1, t1, a1) that's index 1. With a b-roll overlay already at index 1, it's index 2.

Little Oven Bakery's Short is 27 seconds long, which is 810 frames at 30 fps. Use the project's fps from the first line of `get_project`. First add the track:

```json
{"op":"add_track","track":{"kind":"overlay","name":"Color"},"index":1}
```

The result gives the new track's id (o1 here). In the next call, add the layer from frame 0 to the end of the last clip. This one is Golden at 70%:

```json
{"op":"add_clip","trackId":"o1","clip":{"type":"adjustment","start":0,"duration":810,"transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"cover"},"adjust":{"brightness":0.035,"contrast":0.035,"saturation":0.14,"temperature":0.35,"hue":0,"vignette":0}}}
```

How the layer behaves:

- Its transform's opacity is its amount: how much of the change shows. `get_project` shows it as amount=1. Its place, size and rotation do nothing.
- To turn the whole look down in one step, lower the amount. The example after this list sets the layer (c30 here, from the add result) to 0.7.
- If the video gets longer, clips past the layer's end play ungraded. Stretch it with `trim_clip`, edge "end", and to set to the video's new last frame.
- For a flashback or another real change of look, split the layer at both ends of that part with `split_clip`, then give the middle piece its own numbers, such as B&W's.
- Don't also put the look on each clip. A clip's adjust and the layer stack, so Warm on both is twice as warm.
- Hiding the Color track (`update_track` with hidden true, or the eye on the track in the editor) shows the video without it. It's an easy before and after.

```json
{"op":"update_clip","clipId":"c30","patch":{"transform":{"opacity":0.7}}}
```

Color can change over time, too. A layer takes keyframes on its colors and its opacity. The Marrow Street Ramblers' 30-second video (900 frames at 30 fps) starts in black and white and blooms into color when the chorus hits at 8 seconds (frame 240), over half a second (15 frames):

```json
{"op":"add_clip","trackId":"o1","clip":{"type":"adjustment","start":0,"duration":900,"transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"cover"},"keyframes":{"saturation":[{"at":240,"value":-1,"ease":"ease_in_out"},{"at":255,"value":0}]}}}
```

Before the first keyframe the value holds at -1, and after the last one it stays at 0. at counts frames from the layer's start. A keyframed color ignores the same key in adjust.

If `get_project` shows a "LUTs:" line, someone loaded color tables (.cube files) into the project. Don't build one yourself. Use a loaded one by the id that line gives, in the grade, with lutAmount from 0 to 1:

```json
{"op":"update_clip","clipId":"c30","patch":{"grade":{"lut":"lut1","lutAmount":0.6}}}
```

The rest of the grade (the lift, gamma and gain wheels, and the curves) is fine control. It's easy to push wrong when you can't see the picture. Don't change a grade a person set. When they want that kind of control, point them to "Wheels, curves and LUT" and "Scopes" in the Color section.

## Skin tones

Skin is the color everyone checks. People forgive a sky that's a little too blue. They don't forgive an orange face.

With faces on screen, keep the total (the clip's adjust plus the layer's numbers times its amount) within these limits:

- saturation +0.3 or less,
- temperature from -0.15 to +0.35,
- contrast +0.25 or less, so faces don't get hard shadows,
- hue at 0 in your own fixes. A hue turn moves skin toward green or purple.

So on people talking to camera, use Vivid at 80% or less, Golden at 70%, Drama at 70%, Dusk at 70%, Pop at 50% and Cool at 40%. Warm, Soft, Fade, Vintage, Moody and B&W fit at full strength.

When a face looks wrong, fix that clip:

- Gray or bluish (shade, a cloudy day, cool white LEDs): temperature +0.1 to +0.2, saturation +0.05.
- Orange or red (warm bulbs, candlelight, stage lights at a gig): temperature -0.1 to -0.2, saturation -0.1.
- Green (tube lights in offices, gyms and classrooms): there's no tint slider, and temperature won't fix it. Lower saturation by 0.1 so it shows less, and ask the person to pull it toward magenta with the wheels.
- Shiny or harsh (direct sun, a phone flash): contrast -0.1.
- Under colored stage lights, like purple or green, no setting brings skin back. Suggest B&W for those clips, or for the whole video, and ask first.

A face in shadow is harder. Brightness on the whole clip also brightens the bright window behind them. When the speaker stays in one place, light just the face with a masked layer. A study channel's 3-minute video (5,400 frames at 30 fps) has the host sitting left of center. This layer goes on its own overlay track just before the Color track, so the look goes over it. Clips on one track can't overlap:

```json
{"op":"add_clip","trackId":"o2","clip":{"type":"adjustment","start":0,"duration":5400,"transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"cover"},"adjust":{"brightness":0.1,"temperature":0.05},"mask":{"shape":"ellipse","x":0.35,"y":0.42,"width":0.3,"height":0.6,"feather":0.6}}}
```

The mask's x and y are its center and width and height its size, all shares of the frame. feather softens its edge, as a share of its shorter side. If the speaker moves around, skip the mask and ask the person to fix it in the editor.

## Matching a space's style

Before you grade, call `get_editing_guide` with the space. If the guide ends with "## This space's style", read its look field, its always and never lists, and its notes.

- look "natural": no look. Only fix clips that stand out. Don't add a look because it would "pop", unless the person asks.
- look set to an id, like "golden": put that look on one adjustment layer over the whole video. The style saves the look, not a strength. Start at full strength, and lower it only as far as the skin limits need. Then say so: "Golden at 70%, so faces don't go orange."
- No look saved and nobody asked: leave the color natural, apart from fixing clips that stand out. You can offer a look in one line.
- always and never may hold color rules, like "never black and white". The notes may describe it in words, like "bright and clean, like the shop." Follow them.

The references help when the field is empty, or when you want the strength:

- A past project lists the looks its clips used, by id, and how often. If one look leads the count, that's their look. To copy it exactly, find that project with `list_projects`, read it with `get_project`, and copy its adjust numbers and its layer's amount.
- An analyzed video lists its average brightness and saturation (0 to 1) and warmth (-1 is blue, 1 is orange). Warmth above about 0.2 leans toward Warm, Golden or Soft, and below about -0.2 toward Cool, Dusk or Moody. Low saturation points to Fade, Vintage or Moody, and near 0 is black and white. These are averages of the footage, though. A sunny beach video is warm with no look at all, so treat them as hints.
- The frame sheets are better. `get_editing_guide` with topic "style" and the space returns a grid of frames, with their times, for each analyzed video, when your client can show images. Look at the whites (creamy is warm, clean is natural, bluish is cool), the shadows (deep black means contrast, milky gray means Fade, Soft or Vintage), how strong the colors are, whether the corners are dark, and the skin.
- A link gives a title and an author at most, and from Vimeo a length and a description. Don't guess colors from a title.

When the person settles on a look they want every time ("always this golden feel"), offer to save it. Editors and admins can call `save_style` with the space and `fields` set to `{"look":"golden"}`. Or point them to the Look field on the space's Settings → Style page. Never save a look they haven't agreed to.

When you're done, read the project with `get_project`. Check that the layer runs the whole video, that no clip carries the look twice, and that the totals stay inside the skin limits. Then tell them plainly, for example: "I added Golden at 70% on a new Color track under the titles, and warmed the gym clip at 0:12 a little. Drag Look strength in the Color section to change it, or hide the Color track to compare." People can undo any change from the editor's Activity list.

## Common mistakes

- The same look on each clip and on a layer. They stack, and the video comes out twice as warm. Pick one place.
- Switching looks by sending only the new look's keys. The old look's vignette or hue stays behind. Send all six.
- The adjustment layer on the top track. It recolors titles, captions, shapes and the logo. Put it under them.
- A layer that ends before the video does, so the last clips play ungraded. Stretch it with `trim_clip`.
- B&W, Noir or Sepia at half strength. That's a washed-out color picture, not black and white.
- Pop or Vivid at full strength on people talking. Faces go orange.
- Turning hue to fix a color cast. It turns skin too. Use temperature for blue or orange, and ask for the wheels for green.
- Adding a look when the style says "natural", or saving a look to the style without asking.
