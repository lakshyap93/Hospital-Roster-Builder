# Hospital Roster Builder

A mobile-friendly workspace for maintaining hospital staff details, preparing monthly duty rosters, recording leave, and sharing a combined daily duty message.

## Features

- Maintain a staff directory with names and optional staff IDs.
- Create multiple named rosters for a month, save them, and reopen them from roster history.
- Enter one duty or a combined duty such as `M/E`; add extra duty codes when needed.
- Select, reorder, and copy staff rows while building a roster. Add editable blank rows and optional subtitles below staff names.
- Record leave dates and notes. Leave records add the `LE` duty marker to the matching staff member's roster dates.
- Combine duties across saved rosters for a selected date, edit the message preview, then copy or open it in WhatsApp.
- Print rosters and leave history, and export roster PDFs or Excel files.
- Use keyboard navigation in the roster grid, responsive layouts, and installable PWA support.
- Sign in to the shared workspace; the browser signs out after six hours.

## Important account model

This version has one shared signed-in workspace. Every authenticated account can work with the same staff, leave, and roster data; individual staff-only accounts and role-based access are not implemented. Disable public sign-ups and anonymous sign-ins in Supabase Auth, and create accounts only for people authorized to access the shared workspace.

## Technology

- Static HTML, CSS, and JavaScript pages.
- Supabase Auth and Postgres accessed with the public anon/publishable key and row-level security.
- A Vercel serverless function at `api/config.js` supplies runtime public configuration through `/config.js`.
- Vercel rewrites provide clean page routes. The service worker supports app installation and static offline caching.

There is no npm install or frontend build step. Vercel serves the static files and deploys the `api/` function.

## Run locally

1. Copy `config.example.js` to `config.js`.
2. In `config.js`, replace the placeholder Supabase URL and key with the project's **public anon/publishable key**. Do not use a service-role or secret key.
3. From the project folder, start a local static server:

   ```powershell
   py -m http.server 5501
   ```

4. Open `http://localhost:5501/login.html`.

The local static server uses `config.js` directly. The Vercel deployment instead rewrites `/config.js` to `api/config.js` and reads its configuration from Vercel environment variables.

## Supabase database setup

The SQL files in `database/` are migrations for an existing project. This repository does not include the initial schema creation for the core `staff`, `rosters`, `roster_staff_snapshots`, and `roster_assignments` tables. Create or retain those core tables first.

Run the applicable scripts in the Supabase SQL Editor:

1. `database/secure-workspace-access.sql` — enables row-level security and limits the core shared workspace tables to authenticated users.
2. `database/roster-manual-rows.sql` — stores editable blank roster rows in the database.
3. `database/roster-staff-subtitle.sql` — syncs roster staff subtitles across devices.
4. `database/staff-leave.sql` — creates the leave history used by the Staff Leave page and automatic `LE` markers.
5. `database/allow-multiple-rosters-per-month.sql` — run only if the database rejects saving a second roster for the same month and year.

The security migration removes existing policies on the four core tables before adding its shared-workspace policy. Review it against any custom policies before applying it to a project with other applications or access rules.

## Deploy to Vercel

1. Push the project files to a GitHub repository and import that repository into Vercel. The GitHub repository can be private; the deployed app itself is still reachable by anyone with its URL.
2. In Vercel **Project Settings → Environment Variables**, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` for each environment you use (Production and Preview).
3. Confirm that the Supabase Auth settings disable **Allow new users to sign up** and **Allow anonymous sign-ins**. Provision only authorized accounts.
4. Apply and verify the database scripts required by the features you use.
5. Deploy, then verify `/config.js` returns the public configuration with `Cache-Control: no-store` and that anonymous database reads are denied.
6. Sign in with an authorized account and check staff edits, roster save/open, leave saves, exports, and the daily message before sharing the site.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the security checklist and migration notes.

## GitHub: files to keep out

Never commit local configuration or credentials:

- `.env` and any other `.env.*` file containing real values.
- `config.js` or `env.js` created for local use.
- Any Supabase service-role key, `sb_secret_` key, database password, private key, or token.
- The `.vercel/` local project folder, editor settings, logs, and `node_modules/` if they are added later.

The `.gitignore` excludes these local files. Commit `.env.example` and `config.example.js`; they contain placeholders only. `api/config.js` and the `database/` SQL scripts are application files and should be committed. The local `supabase.js` and `supabase2.js` bundles are not referenced by any page—the Supabase browser SDK is loaded from jsDelivr—so they are not required for deployment.

Even though an anon/publishable key is intended for browser use, never put a service-role or secret key in frontend code. Database row-level security is what protects workspace data.
