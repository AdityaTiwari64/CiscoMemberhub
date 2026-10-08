# Club ID + QR Admin Dashboard

## Setup
1. Create a Supabase project. In **Authentication → Providers → Email**, turn OFF "Allow new users to sign up".
2. SQL Editor → paste and run `supabase/schema.sql`.
3. Authentication → Users → **Add user** (your admin email + strong password). Copy its UUID, then run:
   `insert into public.admins (user_id) values ('<uuid>');`
4. `cp .env.example .env` and fill in the project URL + **anon** key.
5. `npm install && npm run dev`

## How it works
- Each member has a random 32-char `qr_token`. The QR encodes `https://your-site/m/<token>`.
- **Assign QR** generates the token server-side; **Download QR** gives you a PNG (or use your own generator with the same URL).
- **Upload QR** (for existing members) decodes the image, extracts the token, links it to the member, and stores the image in a private bucket.
- Scanning opens `/m/<token>` which calls `get_member_by_token` and shows only name, role, department and contributions.

## Security notes
- Tables are locked by RLS; only users listed in `admins` can read/write. The public can only call `get_member_by_token`.
- Only the anon key is in the frontend. Never ship the service_role key.
- Deactivating a member or re-assigning their QR instantly kills the old card.
- Deploy on HTTPS; the `vercel.json` rewrite makes `/m/<token>` work on refresh.
