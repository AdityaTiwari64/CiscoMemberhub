# Cisco Community Member Hub

Member passes, contributions, and event attendance for the Cisco Community at VIT Bhopal.

## Supabase setup

1. Create a Supabase project and turn off public sign-ups under **Authentication → Settings**. Accounts should be invited by an administrator.
2. Run `supabase/setup_complete.sql` in the Supabase **SQL Editor**. It creates the app tables and row-level security policies without any credentials embedded in this repository.
3. Create or invite the first administrator in **Authentication → Users**. Copy that user's Auth UUID and add it to `public.admins` from SQL Editor:

   ```sql
   insert into public.admins (user_id) values ('PASTE_ADMIN_AUTH_UUID_HERE');
   ```

4. Invite HR users through **Authentication → Users**. Run `supabase/hr_attendance_access.sql` for an existing project, then assign `cisco_role: attendance_hr` in `auth.users.raw_app_meta_data` for each invited Auth user. This role can scan and delete attendance records, and cannot edit members or contributions.

## Deploy to Vercel

1. Import this repository into Vercel. Use the Vite framework preset, `npm run build` as the build command, and `dist` as the output directory.
2. Add these environment variables in the Vercel project settings for Production and Preview:
   - `VITE_SUPABASE_URL` — your Supabase project URL.
   - `VITE_SUPABASE_ANON_KEY` — your Supabase publishable key, or legacy anon key.
3. Redeploy. Set the deployed site as the Supabase Auth **Site URL** and add its URL to the allowed redirect URLs if you use invitation or recovery emails.

The Vite-prefixed Supabase values are included in browser code by design. Use only the publishable/anon key there. Never add a Supabase secret or `service_role` key, account passwords, or private member data to a `VITE_` variable or this repository. Keep local `.env` files untracked.

## Data access notes

- The public `/m/:token` page uses an unguessable QR token and returns only the member name, role, department, join date, and contributions. It does not return email addresses.
- Member, contribution, and attendance table access is controlled by Supabase RLS. The HR attendance permissions are enforced by database policies, not just by hiding admin UI.
- Event setup is stored in the browser's local storage; the attendance rows themselves are stored in Supabase.
- Configure the Content Security Policy in `vercel.json` to include your Supabase host if you use a custom Supabase domain instead of `*.supabase.co`.
