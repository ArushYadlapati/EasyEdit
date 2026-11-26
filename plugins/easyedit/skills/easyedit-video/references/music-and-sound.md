# Music and sound

Read this when you add music, set how loud voices and songs are, fade or duck sound, clean up a recording, or end a video on the beat.

## The short version

- Voice comes first. Keep speech at volume 1, or where Level volume put it. Music sits under it: about 0.15 to 0.25 while someone talks, 0.6 to 1 when nobody does.
- Pick the music's energy from the space's style (its music field) and the video's pace. You can't hear files, so go by names, events and lengths, and ask which song when there's a choice.
- Times are whole frames. At 30 fps, 0.5 s is 15 frames and 2 s is 60. Read the fps from the Format line at the top of `get_project` and use that.
- Fade music in over about 0.5 s and out over 1 to 2 s (15, and 30 to 60 frames at 30 fps), unless it starts right on the hook or ends with the song's own ending.
- Duck music under talking with volume keyframes. `at` counts from the music clip's start, and each ramp takes about 0.3 s (9 frames at 30 fps).
- To work on a video's sound by itself, add an audio clip of the same asset with the same start, duration, in and speed, then set the video clip's volume to 0.
- Clean up a voice with the clip's sound fields. Never put noise reduction on music.
- End on a beat: land the last cut on a strong beat, and stop the music on the video's last frame.

## Pick music that fits

Music sets the mood faster than anything on screen. Match it to what the video is for and how fast it moves.

- If the space has a saved style, read it first. `get_editing_guide` with space ends with "## This space's style", and its music field is none, soft, upbeat or intense. Follow it unless the person asks for something else.
- The style's references help too. A past project shows its music level. An analyzed reference video shows how loud it is and how much of it is talking. A reference that's mostly talking wants music low, or none.
- When the person states a lasting rule ("no music on our interviews"), offer to save it with `save_style`: fields music "none", or a line added to never, keeping the lines already there. Editors and admins can save a style. People can also change it on the space's Settings → Style page.

What each energy sounds like:

- none: the sound is the point. An interview, a study channel walking through a formula, or a band's own song. Never lay another track over a band's music.
- soft: calm and steady, easy to talk over. A bakery's 5 a.m. bread routine, a cooking voice-over, a study-with-me timelapse.
- upbeat: a clear, bright beat. A student council's spirit week recap, a bike shop's new-arrivals reel.
- intense: big drums and hits. A soccer club's goal of the week, a race-day montage.

Pace and energy go together. A style with pace quick or rapid and short shotSeconds usually wants upbeat or intense music, with cuts on the beat.

In EasyEdit:

- Songs live in the space's media. Find them with `list_assets` kind "audio", and pick one from the project's own space: each line names its space, and a project can only use its own space's media. Go by the file's name, its event and its length. When there are several, ask which one, and ask where the chorus or the drop starts.
- Start the song at its strong moment, not its quiet intro. For a chorus at 0:42 in a 30 s Short, use `add_media` with start_seconds 0, in_seconds 42 and duration_seconds 30. It finds a free audio track or makes one. Without start_seconds it goes after whatever is already on that track.
- If they want a song that isn't in the library, ask them to upload it in the editor's Media tab. Use only music they have the right to use; platforms can mute or remove videos that use a song without permission.
- On TikTok and Reels, many people add a trending sound in the app when they post. Ask first. If they will, leave the music out and keep the voice clean, so the app's sound doesn't fight a second song.
- Long YouTube videos often keep music to the intro, the outro and short montages. Under someone talking for minutes, it sits very low (about 0.1) or stops.

## Set the levels

Get the voice right first, then fit everything else around it. People forgive a quiet song. They scroll past a voice they can't hear.

- volume runs from 0 (silent) through 1 (as recorded) to 4 (four times as loud). 0.5 is about 6 dB down, 0.25 about 12 dB down, 0.1 about 20 dB down.
- Go above 1 only for footage recorded too quietly, like a phone at the back of a gym. Sound past full scale distorts.
- Starting points, since you can't hear: voice 1. Music under a voice 0.15 to 0.25. Music on its own 0.6 to 1. A video's own sound under music 0 to 0.3 (a crowd's cheer at 0.3 gives soccer highlights some life).
- The editor's Level volume button, in the Sound section, listens to the selected clips and sets each one's volume so they all come out at one level without distorting. You can't do that yourself. When clips came from different phones or distances, ask the person to select the talking clips and press it, then set the music around them.
- Tell the person what you set and ask them to listen once. Shift+M shows the editor's audio meter.

Set one clip's volume:

```json
{"op":"update_clip","clipId":"c5","patch":{"volume":0.2}}
```

A track has a volume too, from 0 to 4. It multiplies the volume of every clip on that track, so 0.5 on the music track halves every song on it and keeps their ducking. It's the quickest fix for "the music is too loud overall".

```json
{"op":"update_track","trackId":"a1","patch":{"volume":0.5}}
```

- Muting a track (`update_track` with muted true) silences every clip on it, and hiding a track silences the videos on it too. To silence one clip, set its volume to 0.
- pan places a clip's sound from -1 (left) to 1 (right). Leave it at 0 for voices and music. A phone speaker loses most of it, and in earbuds an off-center voice feels wrong.
- `get_project` shows each clip's vol, its fades and its sound settings. It doesn't list a track's volume or a clip's pan, so say what you set.

## Fade in and out

fadeIn and fadeOut are the frames a clip's sound takes to rise from silence at its start and fall back at its end. They work on video and audio clips, and 0 removes one. The numbers below are at 30 fps.

- Music that starts under a scene: fadeIn about 15 frames (0.5 s). When the song starts on the hook at frame 0 and should hit right away, use 0 to 3 frames.
- Music at the end: fadeOut 30 to 60 frames (1 to 2 s), unless the song's own ending lands on the video's last frame.
- Voice clips cut from a longer take: 2 frames at each end takes the click off a hard cut without eating a word.
- Keep fadeIn plus fadeOut no longer than the clip. If they add up to more, the fade out gets cut short.

```json
{"op":"update_clip","clipId":"c5","patch":{"fadeIn":15,"fadeOut":60}}
```

```json
[
  {"op":"update_clip","clipId":"c2","patch":{"fadeIn":2,"fadeOut":2}},
  {"op":"update_clip","clipId":"c3","patch":{"fadeIn":2,"fadeOut":2}}
]
```

A split keeps the fade in on the first piece and the fade out on the second, so the cut between them stays smooth.

## Duck music under talking

Ducking turns the music down while someone talks and brings it back after. Use it when a video switches between talking and music-only moments. If someone talks the whole way through, just set the music low and skip the keyframes.

- Volume keyframes go in keyframes.volume, on a video or audio clip. Values run 0 to 4.
- at counts frames from the music clip's start, not the timeline's. If the music starts at frame 60, a word at timeline frame 300 is at 240.
- A keyframed volume replaces the clip's volume field. Before the first keyframe and after the last, the volume holds at that keyframe's value.
- Find the talking in the caption lines of `get_project`: each one gives its time and its words. Without captions, ask the person when the talking starts and stops.
- Start the dip a little before the first word and come back a little after the last: about 0.3 s, 9 frames at 30 fps. Leave pauses shorter than about 0.6 s (18 frames) down, so the music doesn't pump between sentences.
- Ducking to about a quarter of the full level (0.8 down to 0.2) is a good start.

A soccer club reel at 30 fps: the music clip c5 starts at frame 0 and plays at 0.8. The coach talks from 4.0 s to 13.0 s (frames 120 to 390), then again from 20.0 s to 26.5 s (frames 600 to 795).

```json
{"op":"update_clip","clipId":"c5","patch":{"keyframes":{"volume":[
  {"at":111,"value":0.8},
  {"at":120,"value":0.2},
  {"at":389,"value":0.2},
  {"at":398,"value":0.8},
  {"at":591,"value":0.8},
  {"at":600,"value":0.2},
  {"at":794,"value":0.2},
  {"at":803,"value":0.8}
]}}}
```

- To change one keyframe, send the whole volume list back with that one changed. To take the ducking off, send an empty list:

```json
{"op":"update_clip","clipId":"c5","patch":{"keyframes":{"volume":[]}}}
```

- To make ducked music quieter overall, lower its track's volume instead of rewriting every keyframe.
- The person can also select a music clip in the editor and press Duck under speech in its Sound section. It writes these keyframes for them and, where a file has captions, follows each word. It ducks under every other clip that has sound, so set b-roll's own sound to 0 first. Offer it when they'd rather click than wait.
- A split keeps the keyframes on both pieces, so ducked music stays ducked.

## Separate a video's sound

Sometimes a video's sound needs to live apart from its picture. A cooking creator's voice keeps going over close-ups of the pan, or an interview's audio needs its own clean-up and fades.

- Add an audio clip of the same video asset on an audio track, with the same start, duration, in and speed, and the video clip's volume. Then set the video clip's volume to 0. `get_project` shows in as seconds, so turn it into frames (2.0 s is 60 frames at 30 fps).
- Give both clips the same group name. In the editor, linked clips are selected, moved and deleted together.
- Move the video clip's fades and captions over too: set them on the audio clip, and set fadeIn 0, fadeOut 0 and captions false on the video.
- If the project has no audio track, add one first (`add_track` with kind "audio" and a name) and use the id from the result in your next call.
- The person can also press Separate audio in a video clip's Sound section, which does all of this in one step.

At 30 fps, the cooking clip c2 starts at frame 90, runs 300 frames, plays at volume 1, and shows its file from 2.0 s (in 60):

```json
[
  {"op":"add_clip","trackId":"a1","clip":{"type":"audio","assetId":"asset7","start":90,"duration":300,"in":60,"speed":1,"volume":1,"group":"chef-voice","transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"cover"}}},
  {"op":"update_clip","clipId":"c2","patch":{"volume":0,"group":"chef-voice"}}
]
```

Now you can cut the picture to close-ups while the voice runs on, or duck and clean the voice without touching the shot.

## Clean up a voice

Each video and audio clip has a sound field for clean-up. Every part is off until you set it, and a patch changes only the parts you name.

- lowCut (true or false): cuts rumble below a voice, like wind, traffic or a bumped phone. Safe on almost any voice.
- denoise (0 to 1): turns down steady noise such as hiss, a fan or a fridge hum. 0.3 to 0.5 for a voice. Keep it off music: it can take a long held note along with the noise.
- gate (0 to 1): turns down the room sound between words. About 0.25. Much higher and the ends of words get clipped.
- compress (0 to 1): brings loud and quiet words closer together. About 0.5 for a talking head, and it helps a voice sit above music.
- bass, mid, treble (-12 to 12 dB, around 200 Hz, 2500 Hz and 5000 Hz): mid, called Presence in the editor, at +2 to +4 makes speech clearer. bass at -2 to -4 tames a boomy room or a mic held too close. treble at +1 to +2 brightens a dull clip-on mic.

You can't hear the clip, so ask what's wrong ("Is there a hum? Is it boomy? Do some words jump out?") and fix that. When they just say "it sounds rough", the editor's Clean up voice settings are a safe start:

```json
{"op":"update_clip","clipId":"c2","patch":{"sound":{"lowCut":true,"gate":0.25,"bass":0,"mid":3,"treble":1,"compress":0.5,"denoise":0.4}}}
```

A bike shop owner filmed outside on a windy day? Cut the rumble and a little low end, and leave the rest alone:

```json
{"op":"update_clip","clipId":"c3","patch":{"sound":{"lowCut":true,"bass":-3}}}
```

To take all clean-up off, set every part back to off:

```json
{"op":"update_clip","clipId":"c2","patch":{"sound":{"lowCut":false,"gate":0,"bass":0,"mid":0,"treble":0,"compress":0,"denoise":0}}}
```

`get_project` shows what's set as sound={...} on the clip. In the editor, the same controls sit under Clean up in the clip's Sound section, with a Clean up voice button and a Reset. The whole mix also passes through a limiter that keeps it under -1 dB, so one loud moment won't crackle. Don't lean on it: set levels so nothing needs catching.

## End on the beat

Cuts that land on the beat feel right, even when people can't say why. The ending matters most: a song cut off mid-phrase makes a video feel unfinished.

- You can't hear the beat. Ask for the song's tempo (BPM), or ask the person to play the music in the editor and press B on the beats they like. B drops a marker at the playhead, and `get_project` lists markers with their times on a Markers line.
- From a tempo, one beat is 60 ÷ BPM seconds. At 120 BPM that's 0.5 s, or 15 frames at 30 fps, and a bar of 4 beats is 60 frames. At 90 BPM a beat is 20 frames and a bar is 80.
- Count each beat from the first one instead of adding a rounded beat over and over, or the cuts drift. At 128 BPM and 30 fps a beat is 14.0625 frames, so beat 16 is 225 frames after the first, not 16 × 14 = 224.
- Land the last cut on a strong beat (the first beat of a bar). Hold that final shot, like a logo, an end card or the finished cake, for 1 to 2 s, and fade the music out over the hold.
- Or end with the song's own ending. Back-time it so its end lands on the video's last frame: for a 30 s video and a 2:14 song (134 s), `add_media` with start_seconds 0, in_seconds 104 and duration_seconds 30. Give it a short fadeIn, about 0.2 s (6 frames at 30 fps), since it now starts mid-song.
- The music ends on the same frame as the last picture. Music past the end leaves the screen black; music that stops early leaves a silent ending.

A band's tour teaser at 30 fps: the last cut lands on a downbeat at 26.0 s, where the end card c9 starts. The video ends 2 s later at 28.0 s (frame 840). Trim the end card and the band's own song c5 to end there, and fade the song over the last second:

```json
[
  {"op":"trim_clip","clipId":"c9","edge":"end","to":840},
  {"op":"trim_clip","clipId":"c5","edge":"end","to":840},
  {"op":"update_clip","clipId":"c5","patch":{"fadeOut":30}}
]
```

## Common mistakes

- Turning the music up so the video feels punchy, and burying the voice. Set the voice first and fit the music under it.
- Counting volume keyframes from the timeline's start instead of the clip's start.
- Changing volume on a clip that has volume keyframes. The keyframes win: edit the list, or lower the track's volume.
- Separating a video's sound but leaving the video's own volume up. The voice plays twice, too loud or with a slight echo.
- Muting or hiding a whole track to silence one clip, which silences everything else on it too. Set that clip's volume to 0.
- Putting denoise on music, or a gate so high it clips the ends of words.
- Working in seconds, or at 30 fps, when ops want whole frames at the project's fps (24, 25, 30, 50 or 60). `list_assets` counts frames at 30 fps, so work from its seconds.
- Moving only half of a linked pair. Your ops move one clip at a time, so move or trim the picture and its sound together.
