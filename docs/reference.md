# Roles, formats and limits

The rules for each role, the video formats a project can use, and the limits on posting, uploaded media and a space's style. For what works today, see [status.md](status.md).

## Who can do what

Every person on the allowlist has one of three roles.

| Role | What they can do today |
| --- | --- |
| Viewer | Sign in, see the dashboard and its folders, open projects, see the media library and play media. Cannot create or change anything. |
| Editor | Everything a viewer can, plus create, rename, duplicate and delete projects, keep them in folders (make, rename and delete folders), and change them. Upload media, and rename and remove it. Deleting hides a project; it is not shown again. Deleting a folder never deletes its projects. |
| Admin | Everything an editor can, plus open the Admin page to add, re-role and remove people. |

Some rules:

- Only emails on the allowlist can sign in. Emails are stored in lowercase.
- A Google account whose email Google has not verified is always rejected.
- There must always be at least one admin. The last admin cannot be demoted or removed.
- Removing someone signs them out right away. They are sent to `/login` on their next request.
- Removing someone also ends all their AI agent connections and access tokens right away.
- A file that a project uses cannot be removed from the library. Take it out of that project first.
- You stay signed in for 30 days after your last visit. Each visit starts the 30 days again.
- People in a project see which projects you have open in the editor and what you have selected.

## Project formats

| Format | Size |
| --- | --- |
| Short 9:16 | 1080 x 1920 |
| Feed 4:5 | 1080 x 1350 |
| Square 1:1 | 1080 x 1080 |
| Long 16:9 | 1920 x 1080 |
| Long 4K | 3840 x 2160 |
| Custom | Any even width and height from 16 to 4096 pixels, up to the area of 4K (3840 x 2160) |

All projects run at 30 frames per second. Times in the timeline are whole frames.

## Posting limits

- A space can post 10 videos to YouTube in 24 hours. A post that was started counts, however it ended.
- A title can be up to 100 characters and a description up to 5,000; neither can contain `<` or `>`. These are YouTube's rules.
- Only the space's admins connect or disconnect its YouTube channel. Admins and editors post.
- The channel is disconnected when the person who connected it leaves the team.

## Media limits

- File types: video in MP4, M4V, MOV or WebM; images in JPEG, PNG or WebP; audio in MP3, M4A, WAV or AAC. HEIC photos are not taken: save them as JPEG first.
- Up to 2 GB a file. Two uploads run at a time; the rest wait their turn. Each member can have up to 20 unfinished uploads.
- An upload stops if you leave the editor. It goes on from where it stopped when you choose the same file again within 7 days.
- A video's preview copy is made in the uploader's browser. If you leave the editor or press Cancel while the preview is still being made, the video ends up with no preview: at once after Cancel, after up to two hours if you left the editor or closed the tab. Choosing the file again then uploads a second copy, so remove the first one.
- The preview plays the 720p copy. Playing backward is silent, and a volume above 100% sounds like 100% in the preview.
- Auto captions run in the browser and take English speech only. A file longer than 60 minutes is refused. One caption word is at most 80 characters, a file keeps at most 10,000 words, and a project keeps words for at most 50 files.
- The browser keeps about 2 GB of playback files, so footage you played before does not download again.

## Style limits

- A space's style learns from up to 12 videos, links and past projects in all. The Style page offers the space's 20 most recent projects to pick from, and the 25 newest videos of its YouTube channel.
- Anyone in the space can read its style. Editors and admins change it and what it learns from.
- The summary (In a sentence or two) can be up to 600 characters, and the notes for AI agents up to 2,000. How you open and Voice and tone can be up to 200 characters each.
- Always and Never hold up to 8 things each, and each thing can be up to 140 characters.
- A typical length is from 1 to 3,600 seconds, and a typical shot from 0.2 to 60 seconds.
- A video the style learns from can be up to 4 hours long. Its words are heard and its loudness measured only when it runs 60 minutes or less; a longer one is looked at without them. Its strip of frames holds up to 12 frames and 300 KB.
- A link gives only what its site shares: the title, the author and the picture, and from Vimeo also the length and the description. Instagram links can't be read.
- Details from the space's YouTube channel are cut back to the video's address after 30 days (a daily clean-up does it), and **Refresh** reads them again. They are deleted when the channel is disconnected or another channel takes its place.
- Through an agent, `save_style` adds up to 5 links at a time. Saving a style doesn't count toward an agent's changes a minute or a day.
