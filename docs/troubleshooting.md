# Troubleshooting

Step numbers below refer to [setup.md](setup.md).

- **Google says `redirect_uri_mismatch`.** The redirect URI in Google Cloud does not exactly match `<BETTER_AUTH_URL>/api/auth/callback/google`. Fix it in step 1.
- **Google blocks an account that is on the allowlist.** While the Google app is in Testing, that account also has to be a test user. Add it under **Audience**, then **Test users** in Google Cloud (step 1, item 7).
- **"DATABASE_URL is not set" or similar.** `.env.local` is missing or has an empty value.
- **You land on `/login` with the allowlist message.** Ask an admin to add your email on the Admin page.
- **You land on `/login` with "Sign-in didn't finish".** Sign-in was cancelled or failed partway. Try again. If it keeps happening, ask an admin to check that you're on the allowlist.
- **claude.ai cannot reach or add the connector.** A discovery address is wrong, or `BETTER_AUTH_URL` has a slash at the end. Check that `<BETTER_AUTH_URL>/.well-known/oauth-protected-resource/api/mcp` shows `"resource":"<BETTER_AUTH_URL>/api/mcp"` and `<BETTER_AUTH_URL>/.well-known/oauth-authorization-server/api/auth` shows `"issuer":"<BETTER_AUTH_URL>/api/auth"`, and remove any slash at the end of `BETTER_AUTH_URL`.
- **While connecting an agent, the browser lands on `/api/auth/error?error=invalid_redirect`, or the agent says registration failed with `invalid_redirect_uri`.** The agent used a callback address that is not on the list. Note the `redirect_uri` from the address bar (or the agent's log) and add it to that agent's `redirectUris` in `src/lib/connector/agents.ts`.
- **While connecting an agent, the browser shows `invalid_client`, or "client_id URL is not permitted".** The agent's metadata document is on another host. Note the `client_id` from the address bar and add its host to that agent's `clientDocumentHosts` in `src/lib/connector/agents.ts`.
- **After Google you land on the dashboard, not on the "Connect <agent>" page.** The login hand-off did not carry the request. Start Connect again in the agent while signed in to the website, and report it.
- **Claude is connected, but every tool call fails and claude.ai asks to reconnect in a loop.** Claude did not send the `resource` value, so its token is not bound to `<BETTER_AUTH_URL>/api/mcp`. The endpoint has to be changed to check such tokens another way; report it.
- **"Too many requests" while signing in or connecting.** The rate limit. Wait a minute.
- **The website's own sign-in answers with an error after a deploy.** The migration is not on the live database. Run `pnpm db:migrate` against it (see [Connect an AI agent](ai-agents.md)), or use Vercel's **Promote** on the previous deployment to go back.
- **The Media tab says uploads are not set up.** `GOOGLE_SERVICE_ACCOUNT_KEY` or `DRIVE_FOLDER_ID` is missing where the app runs: in `.env.local` on your computer, or in Vercel's Environment Variables on the deployed app. See [Set up media storage](setup.md#set-up-media-storage), then restart or redeploy.
- **The Media tab says "Couldn't load the library" or that uploads are not set up, while both settings are there.** The key was pasted as the raw JSON file instead of in base64, and the server log says "Drive settings could not be read". Encode the key file with the command in [Set up media storage](setup.md#set-up-media-storage), item 7, put what it prints after `GOOGLE_SERVICE_ACCOUNT_KEY=`, then restart or redeploy.
- **Uploads fail at once on the deployed app but work locally.** `BETTER_AUTH_URL` is not the address in the browser. Set it to the exact address people open, with no slash at the end, and redeploy.
- **A video shows "No preview".** Either the uploader's browser could not read it: upload it again from Chrome or Edge on a Mac, or convert it to H.264 first. Or the uploader left the editor or canceled while the preview was being made: remove it and upload it again.
- **Export says "This browser can't export video. Use a recent version of Chrome or Edge on a computer."** The browser lacks what export needs. Use Chrome or Edge on a computer.
- **Export says "A font didn't load, so the export was stopped. Check your connection, reload the page and try again."** Check the connection, then reload the page and export again.
- **Export says "A media file couldn't be read, so the export was stopped. Check your connection and try again."** Check the connection and export again. Once the media is cached it plays in the preview; then it can be read for the export too.
- **Export says "A video clip couldn't be decoded in this browser, so the export was stopped."** Try Chrome or Edge on another computer, and tell the owner which file it was.
- **Export says "A clip's sound couldn't be decoded in this browser, so the export was stopped. Mute its track to export without it."** Mute that clip's track to export without it. If it is a song, upload it again as mp3 or AAC, and tell the owner which file it was.
- **Export says "The video encoder stopped. Try again."** Try again. The second try already used the slower encoder, so if it stops again, pick the **Draft** size or use another computer.
- **An empty video file after leaving an export.** The export was stopped. Delete the file and export again.
- **After an update, an editor that was open before it says "Export couldn't start. Reload the page and try again."** Reload the page.

**The Drive check** (`node scripts/drive-check/run.mjs`, in [Set up media storage](setup.md#set-up-media-storage)):

| What the script prints | Likely cause | What to do |
| --- | --- | --- |
| F1 fails with `invalid_grant` | The key file is not this service account's, or the computer's clock is wrong | Make a new key ([Set up media storage](setup.md#set-up-media-storage), item 5); check the clock |
| F1 passes, F2 fails with `404` | The `EasyEdit` folder is not shared with the service account, or the id is not that folder's | Item 6; copy the id again from the folder's address |
| F2 fails with `403` and a reason about the Drive API | The Drive API is not enabled in the project that owns the service account | Item 3 |
| Sharing the folder in item 6 is refused | Outside members are not allowed | Item 2, with a Workspace admin |
| F4 fails; the console names `Access-Control-Allow-Origin` | Google Drive no longer lets a page send upload pieces to a session the server opened, so uploads from the browser cannot work | Report it; do not retry with other headers |
| F12 fails with `403` | The role is Contributor, not Content manager | Change the role in the folder's Share dialog |
