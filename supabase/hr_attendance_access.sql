-- Attendance-only HR access. Run after setup_complete.sql / migration_v2.sql.
-- Adds no tables or columns. HR role must be set in auth.users.raw_app_meta_data,
-- which is server-controlled and cannot be changed from the browser client.

begin;

-- Pin the legacy admin helper's lookup path before it is used by the HR guard.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Harden existing definer RPCs as well as the ones replaced below.
alter function public.get_member_by_token(text) set search_path = '';
alter function public.get_my_member_profile() set search_path = '';
alter function public.link_member_user(uuid, uuid) set search_path = '';
revoke all on function public.get_member_by_token(text) from public, anon;
grant execute on function public.get_member_by_token(text) to anon, authenticated;
revoke all on function public.get_my_member_profile() from public, anon;
grant execute on function public.get_my_member_profile() to authenticated;

-- QR tokens are generated only on the server, with cryptographic randomness.
create or replace function public.assign_qr(p_member uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  update public.members set qr_token = v_token where id = p_member;
  if not found then
    raise exception 'member not found';
  end if;
  return v_token;
end;
$$;
revoke all on function public.assign_qr(uuid) from public, anon;
grant execute on function public.assign_qr(uuid) to authenticated;

create or replace function public.is_attendance_hr()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'cisco_role') = 'attendance_hr',
    false
  );
$$;
revoke all on function public.is_attendance_hr() from public, anon;
grant execute on function public.is_attendance_hr() to authenticated;

create or replace function public.can_manage_attendance()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_admin() or public.is_attendance_hr();
$$;
revoke all on function public.can_manage_attendance() from public, anon;
grant execute on function public.can_manage_attendance() to authenticated;

drop policy if exists "hr read attendance" on public.attendance;
drop policy if exists "hr insert attendance" on public.attendance;
drop policy if exists "hr delete attendance" on public.attendance;
drop policy if exists "attendance managers read attendance" on public.attendance;
drop policy if exists "attendance managers insert attendance" on public.attendance;
drop policy if exists "attendance managers delete attendance" on public.attendance;

create policy "attendance managers read attendance" on public.attendance
  for select using (public.can_manage_attendance());

create policy "attendance managers insert attendance" on public.attendance
  for insert with check (
    public.can_manage_attendance()
    and scanned_by = auth.uid()
    and notes like '[cisco-event:%'
  );

create policy "attendance managers delete attendance" on public.attendance
  for delete using (public.can_manage_attendance());

-- Return only what the scanner needs. HR cannot directly read member rows or QR tokens.
create or replace function public.lookup_member_for_attendance(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result json;
begin
  if not public.can_manage_attendance() then
    raise exception 'not allowed';
  end if;

  select json_build_object(
    'id', m.id,
    'full_name', m.full_name,
    'role', m.role
  )
  into v_result
  from public.members m
  where m.qr_token = p_token and m.is_active
  limit 1;

  return v_result;
end;
$$;
revoke all on function public.lookup_member_for_attendance(text) from public, anon;
grant execute on function public.lookup_member_for_attendance(text) to authenticated;

-- Keep the legacy RPC role-checked; it is security-definer and returns all recent check-ins.
create or replace function public.get_attendance_log(p_days int default 30)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 30), 365));
  v_result json;
begin
  if not public.can_manage_attendance() then
    raise exception 'not allowed';
  end if;

  select coalesce(json_agg(row_to_json(t) order by t.scanned_at desc), '[]'::json)
  into v_result
  from (
    select
      a.id,
      a.scanned_at,
      a.notes,
      m.full_name as member_name,
      m.role as member_role
    from public.attendance a
    join public.members m on m.id = a.member_id
    where a.scanned_at >= now() - make_interval(days => v_days)
  ) t;

  return v_result;
end;
$$;
revoke all on function public.get_attendance_log(int) from public, anon;
grant execute on function public.get_attendance_log(int) to authenticated;

-- Keep this legacy no-event RPC admin-only; HR scans use the event-validated client flow.
create or replace function public.record_attendance(p_token text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_att_id uuid;
  v_now timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  select * into v_member
  from public.members
  where qr_token = p_token and is_active
  limit 1;

  if not found then
    raise exception 'member not found or inactive';
  end if;

  insert into public.attendance (member_id, scanned_at, scanned_by)
  values (v_member.id, v_now, auth.uid())
  returning id into v_att_id;

  return json_build_object(
    'attendance_id', v_att_id,
    'member_name', v_member.full_name,
    'member_role', v_member.role,
    'scanned_at', v_now
  );
end;
$$;
revoke all on function public.record_attendance(text) from public, anon;
grant execute on function public.record_attendance(text) to authenticated;

-- After inviting each HR user in Authentication > Users, grant the role by that
-- user's Auth UUID (repeat for each account):
--
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
--     || '{"cisco_role":"attendance_hr"}'::jsonb
-- where id = 'PASTE_AUTH_USER_UUID_HERE';
--
-- Do not use user_metadata for authorization; users can edit user_metadata themselves.
commit;
