# Deployment security checklist

## Vercel runtime configuration

`config.js` is intentionally ignored by Git. The Vercel rewrite serves it from `/api/config`, which reads these Vercel environment variables:

- `SUPABASE_URL` — the HTTPS URL for this Supabase project.
- `SUPABASE_ANON_KEY` — the public anon/publishable key only. `SUPABASE_PUBLISHABLE_KEY` is accepted as an alternative.

Set them for every Vercel environment that should run the app (Production and, if used, Preview). The endpoint returns only the public URL and public key, refuses a service-role/secret key, and is excluded from service-worker caching. Never add a service-role key to frontend config or Vercel client-exposed variables.

## Supabase authorization gate

The browser auth guard is only a user-interface check. A read-only check using the public anon key found that all four data tables returned a row without a signed-in session. **Do not deploy until the RLS migration below is applied and the anonymous read check returns no rows / permission denied.**

Run `database/secure-workspace-access.sql` in the Supabase SQL editor. It enables RLS, removes old policies on those four tables, revokes `PUBLIC`/`anon` table grants, and allows CRUD only to `authenticated` users. The app currently treats signed-in users as one shared hospital workspace. Disable public sign-ups in Supabase and provision accounts only for authorized staff; otherwise anyone may create an account and use this shared workspace. Use owner/tenant columns and matching query filters if accounts should have separate data. The SQL editor action is required because this project has no privileged database credential and must never ship one to the browser.

## Before release

- Set the two Supabase variables in Vercel and verify `/config.js` returns JavaScript with no-store caching.
- Check that an unauthenticated visitor is redirected from each protected route and that signing out clears the local session even when the auth server cannot be reached.
- Verify staff CRUD and roster saves using an authorized account; confirm anonymous REST access is denied in Supabase.
- Inspect the deployed response headers, especially Content-Security-Policy, Strict-Transport-Security, and X-Frame-Options.
- Rotate any privileged key if one was ever placed in a browser bundle, source control, or public deployment.
