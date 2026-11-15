# Setup

The full guide to running EasyEdit on your own computer. You will set up three things: a Google sign-in key, a free database, and a small settings file. Media storage is optional.

## Before you start

You need:

- [Node.js](https://nodejs.org) 24 or newer
- [pnpm](https://pnpm.io/installation) version 11
- A Google account that can use Google Cloud
- A free [Neon](https://neon.tech) account

Download the code and install it:

```bash
git clone https://github.com/ArushYadlapati/EasyEdit.git
cd EasyEdit
pnpm install
```

## 1. Set up Google sign-in

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in.
2. At the top of the page, click the project picker, then **New Project**. Name it `EasyEdit` and click **Create**. Make sure the new project is selected.
3. Open the menu (three lines, top left) and click **APIs & Services**, then **OAuth consent screen**. If you see **Get started**, click it.
4. Fill in the app name (`EasyEdit`) and your email for support. Click **Next**.
5. For Audience, choose **External**. Click **Next**.
6. Enter your email as the contact, agree to the policy, and click **Create**.
7. Add the people who may sign in as test users. Open **Audience**, find **Test users**, click **Add users**, enter each person's Google account, and click **Save** (up to 100 people). Start with `admin@seattlesolvers.com`.

    A new Google app starts in "Testing", where only test users can reach the Google sign-in. So everyone you add on the Admin page also has to be added here.

    Publishing the app lifts that limit, but Google keeps **Publish app** greyed out until the **Branding** page is filled in. That needs a deployed site, so come back to it after [Deploy to Vercel](deploy.md).
8. Open **Clients** (or **APIs & Services**, then **Credentials**) and click **Create client** (or **Create credentials**, then **OAuth client ID**).
9. For Application type, choose **Web application**. Name it `EasyEdit web`.
10. Under **Authorized redirect URIs**, click **Add URI** and enter exactly:

    ```
    http://localhost:3000/api/auth/callback/google
    ```

    When you later put the app on a real web address, add a second URI with that address, for example:

    ```
    https://your-app.vercel.app/api/auth/callback/google
    ```

    The path (`/api/auth/callback/google`) must be exact, with no slash at the end.
11. Click **Create**. Copy the **Client ID** and **Client secret**. You will paste them into the settings file in step 3.

## 2. Set up the database

1. Go to [neon.tech](https://neon.tech), sign up (free), and click **Create project**. Pick any name and region.
2. On the project dashboard, click **Connect**.
3. Turn **Connection pooling** on, and copy the connection string. It starts with `postgresql://`. This is your `DATABASE_URL`.

## 3. Fill in the settings file

1. Copy the example file:

    ```bash
    cp .env.example .env.local
    ```

2. Generate a secret for `BETTER_AUTH_SECRET`:

    ```bash
    openssl rand -base64 32
    ```

3. Open `.env.local` and fill it in:

    | Name | What to put |
    | --- | --- |
    | `DATABASE_URL` | The Neon connection string from step 2 |
    | `BETTER_AUTH_SECRET` | The random text from `openssl rand -base64 32` |
    | `BETTER_AUTH_URL` | `http://localhost:3000` on your computer. On a deployed app, its web address. |
    | `GOOGLE_CLIENT_ID` | The Client ID from step 1 |
    | `GOOGLE_CLIENT_SECRET` | The Client secret from step 1 |

    The two media settings at the end of the file, `GOOGLE_SERVICE_ACCOUNT_KEY` and `DRIVE_FOLDER_ID`, can stay empty for now. See [Set up media storage](#set-up-media-storage).

Never share `.env.local` or commit it to git. It holds secrets.

## Set up media storage

Uploaded video, images and audio are kept in a folder of a Google shared drive. This is optional: without it the app runs and edits as usual, and the Media tab says uploads are not set up. You can skip this section now and come back after step 4.

1. **A folder in a shared drive.** In Google Drive, in a team shared drive where you may share folders: New folder, name it `EasyEdit`. Open the folder and copy the id from the address bar (the part after `/folders/`). This is `DRIVE_FOLDER_ID`.
2. **Let an outside account in (only if step 6 is refused).** The service account's address ends in `gserviceaccount.com`, so it is outside the domain, and it will not be a member of the shared drive. A manager of the shared drive opens the drive's name, Shared drive settings, and turns on "Allow people outside Seattle Solvers to access files" and "Allow people who aren't shared drive members to access files". If the switch is missing or greyed out, a Workspace admin must allow it first: admin.google.com, Apps, Google Workspace, Drive and Docs, Sharing settings, "Sharing outside of Seattle Solvers" on for the unit that owns the drive.
3. **The Drive API.** In the Google Cloud project that holds the sign-in client: APIs & Services, Library, "Google Drive API", Enable.
4. **A service account.** IAM & Admin, Service Accounts, Create service account, name `easyedit-media`. Give it no project role. Skip the optional steps.
5. **Its key.** Open the service account, Keys, Add key, Create new key, JSON. Move the downloaded file to `~/.config/easyedit/drive-service-account.json` and run `chmod 600` on it. If Google refuses with a policy named `iam.disableServiceAccountKeyCreation`, an organization admin must switch that policy off for this project first.
6. **Share the folder with it.** On the `EasyEdit` folder: Share, add the service account's address (it ends in `iam.gserviceaccount.com`; the service account's page in Google Cloud shows it), role **Content manager**, untick "Notify people". Do not add it as a member of the drive.
7. **Put the two settings in `.env.local`.** Encode the key on one line:

    ```bash
    base64 -i ~/.config/easyedit/drive-service-account.json | tr -d '\n'
    ```

    Put what it prints after `GOOGLE_SERVICE_ACCOUNT_KEY=`, and the folder id from item 1 after `DRIVE_FOLDER_ID=`. The key is a secret, like the rest of `.env.local`: never paste it into a chat, an issue or a commit.
8. **Restart the app.** Stop `pnpm dev` and start it again, so it reads the new settings.

**Check it.** From the project folder, run the Drive check with the key file and the folder id:

```bash
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=~/.config/easyedit/drive-service-account.json DRIVE_FOLDER_ID=<the folder id> node scripts/drive-check/run.mjs
```

Open `http://localhost:3101` in the browser the team really uses (Edge), press **Run check**, and keep the tab in front until the page says it is done (64 MiB up, so one to a few minutes). The terminal prints F1 to F12 and exits 0. In Google Drive, the shared drive's trash holds the `drive-check` folder. If a line fails, see [Troubleshooting](troubleshooting.md).

Good to know:

- The app keeps files in two folders it makes inside the `EasyEdit` folder: `Originals` for what was uploaded, and `Previews` for the preview copies and still pictures.
- Removing a file in the app moves it to the shared drive's trash, where it stays for 30 days.
- Do not rename or move the files in the drive by hand. Rename and remove them in the app instead.
- Uploads work only from the address in `BETTER_AUTH_URL`. A preview deployment or another address cannot upload.

## 4. Run it

Create the database tables, add the first admin, and start the app:

```bash
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm db:seed` adds `admin@seattlesolvers.com` as an admin. It is safe to run again.

When you pull changes that add migrations (new files in the `drizzle` folder), run `pnpm db:migrate` again before `pnpm dev`.

Open [http://localhost:3000](http://localhost:3000) and click the Google sign-in button.

## First-run checklist

These checks need a real Google client and a real database, so work through them once after setup. Tick each one off.

**Database**

- [ ] `pnpm db:migrate` finishes with no errors against your Neon database.
- [ ] `pnpm db:seed` prints `Seeded admin@seattlesolvers.com`.

**Sign-in**

- [ ] Signing in as `admin@seattlesolvers.com` takes you to `/dashboard`.
- [ ] A teammate who is on the allowlist and is a Google test user (step 1, item 7) can sign in.
- [ ] Signing in with a Google account that is not on the allowlist sends you back to `/login` with the message that the account isn't on the allowlist.

**Admin page** (signed in as the admin)

- [ ] Add a second Google account as `viewer`. That account can sign in, and does not see an **Admin** link.
- [ ] While signed in as that viewer, open `/admin`. You see "You don't have access to this page."
- [ ] Back as admin, change your own role to something else while you are the only admin. You get the last-admin error.
- [ ] Remove the viewer. Their next page load sends them to `/login`.

**Projects** (signed in as admin)

- [ ] On the dashboard, create a project and open it. The editor opens with an empty timeline.
- [ ] Add a clip through the API while the editor is open. Within a few seconds the clip shows up on Text 1, without a reload. To try it, copy the project id from the page address (`/editor/<id>`), copy the value of the `Cookie` request header from your browser's developer tools (Network tab, click any request to the app, then look under **Request Headers**), and run:

    ```bash
    curl -X POST http://localhost:3000/api/projects/<id>/ops \
      -H 'content-type: application/json' \
      -H "cookie: <paste cookie here>" \
      -d '{"baseVersion":0,"ops":[{"op":"add_clip","trackId":"t1","clip":{"type":"text","start":0,"duration":60,"text":"GO SOLVERS","transform":{"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":1,"fit":"contain"},"style":{"fontFamily":"Inter","fontSize":96,"fontWeight":800,"color":"#FFFFFF","align":"center"}}}]}'
    ```

    The answer starts with `{"version":1`.

    The cookie is a secret, like `.env.local`: anyone who has it is signed in as you. Do not paste it into chats, issues or commits.
