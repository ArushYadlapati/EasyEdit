# Deploy to Vercel

Steps 1 and 3 mentioned below are in [setup.md](setup.md).

The app is meant to run on Vercel for free, on the Hobby tier. Nobody has run these steps yet, so expect to fix small things the first time.

1. Sign in at [vercel.com](https://vercel.com), click **Add New**, then **Project**, and import the `EasyEdit` repository from GitHub. Vercel recognizes it as a Next.js app. Leave the build settings as they are.
2. Before you deploy, open **Environment Variables** and add the same five names as in `.env.local`:

    | Name | What to put |
    | --- | --- |
    | `DATABASE_URL` | The Neon connection string for the database the deployed app should use |
    | `BETTER_AUTH_SECRET` | A new random text from `openssl rand -base64 32` |
    | `BETTER_AUTH_URL` | The deployed web address, for example `https://your-app.vercel.app`, with no slash at the end |
    | `GOOGLE_CLIENT_ID` | The Client ID from step 1 |
    | `GOOGLE_CLIENT_SECRET` | The Client secret from step 1 |

    For uploads, also add `GOOGLE_SERVICE_ACCOUNT_KEY` and `DRIVE_FOLDER_ID`, with the same values as in `.env.local` (see [Set up media storage](setup.md#set-up-media-storage)). Add these two for **Production** only, and mark them **Sensitive**.

    Then click **Deploy**. If you don't know the web address until the first deploy finishes, set `BETTER_AUTH_URL` afterwards and redeploy.
3. In Google Cloud, open your OAuth client (step 1, item 10) and add the deployed redirect URI, for example `https://your-app.vercel.app/api/auth/callback/google`. Click **Save**.
4. Once, from the project folder on your computer, create the tables and the first admin in the production database. Put the production connection string in front of each command. It takes precedence over the one in `.env.local`:

    ```bash
    DATABASE_URL='<production connection string>' pnpm db:migrate
    DATABASE_URL='<production connection string>' pnpm db:seed
    ```

    `.env.local` must still exist, because `pnpm db:seed` reads it.

    **Writing a new migration:** `pnpm db:generate` numbers its files by position in `drizzle/meta/_journal.json`, not after the last number used (some were skipped), so today it would write `0024_…`, a number that was skipped. Claim the next number (0027) first, and rename the new SQL file, its snapshot and its journal `tag` to it by hand. If the new snapshot took the name of one that exists, put that one back with `git checkout`. A test in `tests/db/migrations.test.ts` checks that the snapshots still chain.

    **Before deploying a version with media:** run the migration against the production database first, with the command above, then deploy. The version that is live now ignores the new table.

    **Before deploying the version with folders and custom sizes:** run the migration against the production database first, with the command above, then deploy. Run it at a quiet time: while it fills in each project's size, opening and saving projects waits for it. After the deploy, run this once in the Neon SQL editor for the production database. It fills in each project's width and height from its timeline wherever the version that was live during the deploy left them empty or out of date, and it is safe to run again:

    ```sql
    update projects set width = (doc->>'width')::integer, height = (doc->>'height')::integer where width is distinct from (doc->>'width')::integer or height is distinct from (doc->>'height')::integer;
    ```

    **Going back to an earlier version after this one:** the earlier version does not know custom sizes. Run the first statement below just before promoting an earlier deployment, and once more right after. It labels each custom-size project Long 16:9 in its timeline as well as in the project list, and keeps its size and clips, so the earlier version's dashboard, editor and Claude's project list keep working while people edit. There those projects read as Long 16:9 at their own size. The earlier editor's Activity list and Claude's undo can fail on a project whose format was changed to a custom size on this version, and undoing a format change made on the earlier version gives Long 16:9 at 1920 × 1080. After coming forward again, run the second and third statements, in that order, then the after-deploy statement above. The second makes every Long 16:9 project whose size is not 1920 × 1080 custom again:

    ```sql
    update projects set format = 'long_16x9', doc = jsonb_set(doc, '{format}', '"long_16x9"') where format = 'custom' or doc->>'format' = 'custom';
    update projects set format = 'custom', doc = jsonb_set(doc, '{format}', '"custom"') where doc->>'format' = 'long_16x9' and ((doc->>'width')::integer, (doc->>'height')::integer) <> (1920, 1080);
    update projects set format = doc->>'format' where format is distinct from doc->>'format';
    ```

    **Before deploying the version with project pictures:** run the migration against the production database first, with the command above, then deploy. Until it has run, that version's dashboard, editor, project API and Claude's tools fail. On its own it only adds two empty columns, which the version that is live now ignores. If the migration for folders and custom sizes has not run yet, the same command runs both together, so follow that paragraph too: run it at a quiet time, and run its statement after the deploy.

    **Before deploying the version with teammates' selections:** run the migration against the production database first, with the command above, then deploy. Then check it ran: in the Neon SQL editor, `select to_regclass('public.project_presence')` must not be empty. Deployed first, the editor still saves and syncs, shows no one's selection, and logs 'The project_presence table is missing'. Going back to an earlier version needs nothing: it ignores the new table, and open editors keep syncing without selections until they are reloaded.

    **Before deploying the version with spaces:** run the migration `0012_spaces` against `dev` first, then against a throwaway Neon branch for the browser check, then against the production database right before the push, with the command above each time. Run it at a quiet time: it rewrites every row of `projects`, `folders` and `assets` in one transaction, so opening and saving projects waits for it. It makes the Seattle Solvers team, a personal space for each person, team memberships from the allowlist, and moves every project, folder and upload into the team. The `space_id` columns get defaults only for the deploy window, so that the version that is live now saves into Seattle Solvers; the first migration of the next stage drops them by hand, because drizzle's snapshot does not know about them. Going back to the earlier version after 0012 has run is safe for the team's own work: it ignores the new tables and columns, and the defaults fill them. But anything people made in their personal space after the deploy would show to the whole team on the earlier version, so go back only soon after the deploy, before anyone has used a personal space. While the earlier version is live (during the deploy, or after going back), a folder name used twice shows a server error instead of 'There's already a folder with that name', because 0012 drops the index it looks for; that is harmless during the deploy, which lasts a few minutes, and stays for as long as the earlier version is live. After the deploy everyone's saved editor layout and preferences reset once, because the editor moved to `/s/…` and its cookies moved with it. Old links (`/dashboard` and `/editor/<id>`) keep working: they redirect. Reload any editor that was open before the deploy: it asks for its media list and playback without saying which space, so both stop working until the page is reloaded. After the deploy, and again after coming forward from the earlier version, run this once in the Neon SQL editor for the production database. While the earlier version is live, changes on the admin page and first sign-ins don't reach the team's memberships, so a person taken off the allowlist or given a new role keeps their old one, and someone who first signed in then can't open Seattle Solvers and has no personal space. These statements make each person's personal space, set each team membership from the allowlist, and remove anyone no longer on it, and they are safe to run again:

    ```sql
    insert into organization (id, name, slug, created_at, kind) select 'personal_' || id, 'Personal', 'personal_' || id, now(), 'personal' from "user" on conflict do nothing;
    insert into member (id, organization_id, user_id, role, created_at) select 'mp_' || id, 'personal_' || id, id, 'admin', now() from "user" on conflict do nothing;
    insert into member (id, organization_id, user_id, role, created_at) select 'mt_' || u.id, 'team_seattle_solvers', u.id, a.role, now() from allowlist a join "user" u on lower(trim(u.email)) = a.email on conflict (organization_id, user_id) do update set role = excluded.role where member.role is distinct from excluded.role;
    delete from member m where m.organization_id = 'team_seattle_solvers' and not exists (select 1 from allowlist a join "user" u on lower(trim(u.email)) = a.email where u.id = m.user_id);
    ```
    **Before deploying the version with storage per space:** run the migration `0013_space_storage` against `dev` first, then against a throwaway Neon branch for the browser check, then against the production database right before the push, with the command above each time. It adds the storage tables, gives Seattle Solvers its shared-drive storage row, and drops the temporary `space_id` defaults that 0012 added. While the earlier version is still live against a 0013 database (the minutes of the deploy, or after going back), it can't start new uploads, because its upload insert no longer matches the database's rule for unfinished uploads. Everything else works. So deploy at a quiet time, and don't go back past this version without telling people that uploads will fail. Also new: a Seattle Solvers server whose Drive key is set but can't be read now answers uploads with "not set up" (409) instead of a server error. When you are ready to let people connect Google Drive, set `STORAGE_TOKEN_KEY` in Vercel (and `GOOGLE_CLOUD_PROJECT` for teams), and do the Google Cloud steps in [Storage per space](setup.md#storage-per-space). Until then Seattle Solvers works as before, and other spaces say storage isn't set up. Leave `OPEN_SIGNUP` unset until the Google sign-in screen is published.

    If you have to stay on the earlier version against a 0013 database, run the first statement below once in the Neon SQL editor for the production database, so the earlier version's uploads work again. It puts back the earlier rule for unfinished uploads next to the new one; while both are there, the same file can't be pending in two spaces at once. After coming forward again, run the second to drop it:

    ```sql
    create unique index assets_unfinished_upload_old on assets (uploaded_by, file_name, size_bytes, last_modified_ms) where status = 'uploading';
    drop index assets_unfinished_upload_old;
    ```

    **Before deploying the version with templates:** run the migration `0022_templates` against the production database right before the push, with the command above. It only adds one table (`templates`), so the version that is live now keeps working against it. Going back to the version that is live now (099b4ad) after it has run is not clean, though. The earlier version doesn't know templates, so it lets people delete media that a template keeps. And its stricter checks on clips reject empty slots (`placeholder`) and the effect fields (transitions, keyframes, text animation), so projects that have either will most likely fail to open or save in its editor. Don't go back past this release unless you have to.

    **Release steps for templates, effects and moving projects:**

    - First check a production build (`pnpm build`, then `pnpm start`) in the browser against a throwaway Neon branch migrated to 0023. Include one real move of a project between two spaces with their own Google Drives.
    - No new settings are needed in Vercel.
    - Run `pnpm db:migrate` once against the production database, right before the push. It applies `0022_templates`, then `0023_project_move`.
    - After the deploy, reload any editor tab that was open before it.

    **Before deploying the version that posts to YouTube:** run the migration `0025_socials` against the production database right before the push, with the command above. It only adds two tables (`social_connection`, `social_post`), so the version that is live keeps working. Run it before the push, not after: the new version's Drive disconnect and team delete read the new tables. Posting stays off until `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` are set in Vercel ([Posting to YouTube](setup.md#posting-to-youtube)).

    **Before deploying the version that moves projects between spaces:** run the migration `0023_project_move` against the production database right before the push, with the command above. It comes after `0022_templates`; if that hasn't run yet, the same command runs both. It only adds: one new table (`project_move`), three nullable columns (`assets.move_id`, `assets.copied_from`, `projects.moved_at_version`) and indexes on the new table. It leaves the rule for unfinished uploads as it was, so the earlier version keeps working against it, during the deploy and after going back. (After going back, copies made by a move that hasn't finished show up in the destination's library, since the earlier version doesn't know to hide them.)

    **Before deploying the version that keeps the words of captioned files:** run the migration `0026_asset_transcripts` against the production database right before the push, with the command above. It comes after `0025_socials`; if that hasn't run yet, the same command runs both. It only adds one table (`asset_transcripts`) and its index, so the version that is live now keeps working against it, during the deploy and after going back. Until it has run, the new version's saved words fail to load and to save, and Auto captions has to transcribe each file again. After the deploy, reload any editor tab that was open before it: an older tab doesn't know the three new caption ops (`set_caption_style`, `set_transcript`, `splice_caption_words`).

    **Before deploying the version with the intro tutorial:** run the migration `0018_tutorial_views` against the production database right before the push, with the command above. It adds one table and changes nothing else, and the earlier version keeps working against it. Set `TUTORIAL_VIDEO_URL` only once the table is there.

    **Before deploying the version with one Google account per space:** first run these two checks in the Neon SQL editor for the production database. The first must return no rows; if it returns any, one Google account already holds two spaces' storage, so stop and sort that out by hand before going on:

    ```sql
    select d.google_sub, count(*) from space_storage s join drive_connection d on d.id = s.connection_id where s.kind = 'google_account' group by d.google_sub having count(*) > 1;
    ```

    The second lists personal spaces that already keep storage in a Google account. While personal spaces are not offered, nobody can see or change that storage, so its Google account can't be connected to a team ("That Google account already holds another EasyEdit space's storage"). For each row whose space holds no uploads, delete its `space_storage` row by hand to free the account; tell the owner of any other:

    ```sql
    select s.space_id, d.email from space_storage s join organization o on o.id = s.space_id join drive_connection d on d.id = s.connection_id where o.kind = 'personal' and s.kind = 'google_account';
    ```

    Then run the migration `0019_one_drive_per_space` against the production database right before the push, with the command above. It turns every viewer (on the allowlist, in a team, or in a pending invite) into an editor, adds `space_storage.google_sub` with one row per Google account, and fills it in for spaces already connected. The earlier version still runs against it, but until the deploy it can still give the viewer role and save a team's storage without its Google account.

    **After the deploy:** run the migration's statements that change rows once more, in the Neon SQL editor, to put right anything the earlier version wrote in between. They change nothing the second time round. If the last one fails on `space_storage_google_sub_unique`, a space was given a Google account another space already holds in the meantime: sort that out by hand.

    ```sql
    update allowlist set role = 'editor' where role = 'viewer';
    update member set role = 'editor' where role = 'viewer';
    update invitation set role = 'editor' where role = 'viewer';
    update space_storage set google_sub = drive_connection.google_sub from drive_connection where space_storage.connection_id = drive_connection.id and space_storage.kind = 'google_account' and space_storage.google_sub is null;
    ```

    `GOOGLE_CLOUD_PROJECT` can then be removed from Vercel, and the "Service Account Admin" and "Service Account Token Creator" roles taken off the media service account: teams no longer get reader service accounts.
5. Optional: publish the Google app, so teammates no longer have to be test users. In Google Cloud, open **Branding** and fill in the app domain details (home page, privacy policy link, authorized domain) with your deployed web address. You will need a public privacy policy page to link to. Then open **Audience** and click **Publish app**. Signing in only asks Google for name, email and profile picture, and the allowlist still decides who gets in. Connecting storage for a space also asks for access to the files EasyEdit itself creates in that person's Drive (`drive.file`), and nothing else in it; see [Storage per space](setup.md#storage-per-space).
