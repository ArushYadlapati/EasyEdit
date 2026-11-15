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
5. Optional: publish the Google app, so teammates no longer have to be test users. In Google Cloud, open **Branding** and fill in the app domain details (home page, privacy policy link, authorized domain) with your deployed web address. You will need a public privacy policy page to link to. Then open **Audience** and click **Publish app**. Signing in only asks Google for name, email and profile picture, and the allowlist still decides who gets in. Connecting storage for a space also asks for access to the files EasyEdit itself creates in that person's Drive (`drive.file`), and nothing else in it; see [Storage per space](setup.md#storage-per-space).
