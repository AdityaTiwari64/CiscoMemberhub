-- migration_v2.sql  —  Run AFTER schema.sql in Supabase > SQL Editor
-- Adds: attendance tracking, member login, and supporting policies/functions.

-- ─── 1. Attendance table ────────────────────────────────────────────────
create table public.attendance (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  scanned_by uuid references auth.users(id),
  notes      text
);
alter table public.attendance enable row level security;
create policy "admins manage attendance" on public.attendance
  for all using (public.is_admin()) with check (public.is_admin());

-- ─── 2. Member ↔ Auth-user linking table ────────────────────────────────
create table public.member_users (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  member_id uuid not null unique references public.members(id) on delete cascade
);
alter table public.member_users enable row level security;
create policy "admins manage member_users" on public.member_users
  for all using (public.is_admin()) with check (public.is_admin());
create policy "members read own link" on public.member_users
  for select using (user_id = auth.uid());

-- ─── 3. Let linked members read their own member row ────────────────────
create policy "member reads own row" on public.members
  for select using (
    exists (select 1 from public.member_users mu where mu.user_id = auth.uid() and mu.member_id = id)
  );

-- ─── 4. Let linked members read their own contributions ─────────────────
create policy "member reads own contributions" on public.contributions
  for select using (
    exists (select 1 from public.member_users mu where mu.user_id = auth.uid() and mu.member_id = member_id)
  );

-- ─── 5. Let linked members read their own attendance ────────────────────
create policy "member reads own attendance" on public.attendance
  for select using (
    exists (select 1 from public.member_users mu where mu.user_id = auth.uid() and mu.member_id = member_id)
  );

-- ─── 6. record_attendance(token) — admin scans a QR, logs attendance ────
create or replace function public.record_attendance(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_member  public.members%rowtype;
  v_att_id  uuid;
  v_now     timestamptz := now();
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  select * into v_member from public.members
    where qr_token = p_token and is_active
    limit 1;
  if not found then raise exception 'member not found or inactive'; end if;

  insert into public.attendance (member_id, scanned_at, scanned_by)
    values (v_member.id, v_now, auth.uid())
    returning id into v_att_id;

  return json_build_object(
    'attendance_id', v_att_id,
    'member_name',   v_member.full_name,
    'member_role',   v_member.role,
    'scanned_at',    v_now
  );
end $$;
revoke all on function public.record_attendance(text) from public, anon;
grant execute on function public.record_attendance(text) to authenticated;

-- ─── 7. get_my_member_profile() — member fetches their own data ─────────
create or replace function public.get_my_member_profile()
returns json language plpgsql security definer stable set search_path = '' as $$
declare
  v_member_id uuid;
  v_result    json;
begin
  select mu.member_id into v_member_id
    from public.member_users mu where mu.user_id = auth.uid();
  if v_member_id is null then return null; end if;

  select json_build_object(
    'id',            m.id,
    'full_name',     m.full_name,
    'role',          m.role,
    'department',    m.department,
    'joined',        m.created_at,
    'is_active',     m.is_active,
    'contributions', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'title', c.title, 'description', c.description,
        'link', c.link, 'date', c.created_at
      ) order by c.created_at desc)
      from public.contributions c where c.member_id = m.id
    ), '[]'::json),
    'attendance', coalesce((
      select json_agg(json_build_object(
        'id', a.id, 'scanned_at', a.scanned_at, 'notes', a.notes
      ) order by a.scanned_at desc)
      from public.attendance a where a.member_id = m.id
    ), '[]'::json)
  ) into v_result
  from public.members m where m.id = v_member_id;

  return v_result;
end $$;
revoke all on function public.get_my_member_profile() from public, anon;
grant execute on function public.get_my_member_profile() to authenticated;

-- ─── 8. link_member_user(member_id, user_id) — admin links a user ───────
create or replace function public.link_member_user(p_member_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  insert into public.member_users (user_id, member_id)
    values (p_user_id, p_member_id)
    on conflict (user_id) do update set member_id = excluded.member_id;
end $$;
revoke all on function public.link_member_user(uuid, uuid) from public, anon;
grant execute on function public.link_member_user(uuid, uuid) to authenticated;

-- ─── 9. get_attendance_log(days) — admin fetches recent attendance ───────
create or replace function public.get_attendance_log(p_days int default 30)
returns json
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 30), 365));
  v_result json;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  select coalesce(json_agg(row_to_json(t) order by t.scanned_at desc), '[]'::json)
  into v_result
  from (
    select a.id, a.scanned_at, a.notes, m.full_name as member_name, m.role as member_role
    from public.attendance a
    join public.members m on m.id = a.member_id
    where a.scanned_at >= now() - make_interval(days => v_days)
  ) t;
  return v_result;
end;
$$;
revoke all on function public.get_attendance_log(int) from public, anon;
grant execute on function public.get_attendance_log(int) to authenticated;

-- For the HR attendance-only portal, also run hr_attendance_access.sql.
