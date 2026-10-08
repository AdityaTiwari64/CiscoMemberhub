-- Run this whole file in Supabase > SQL Editor
create extension if not exists pgcrypto;

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  role text default 'Member',
  department text,
  qr_token text unique,          -- random, unguessable; this is what the QR points to
  qr_image_path text,            -- file in private 'qr-codes' bucket
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  title text not null,
  description text,
  link text,
  created_at timestamptz not null default now()
);

-- helper: is the current user an admin?
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.admins enable row level security;
alter table public.members enable row level security;
alter table public.contributions enable row level security;

create policy "admin reads own row" on public.admins for select using (user_id = auth.uid());
create policy "admins manage members" on public.members for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage contributions" on public.contributions for all using (public.is_admin()) with check (public.is_admin());
-- NOTE: no policy for anon => the public can NOT read tables directly.

-- Admin-only: generate a fresh random QR token for a member
create or replace function public.assign_qr(p_member uuid) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  t := encode(gen_random_bytes(16), 'hex');
  update public.members set qr_token = t where id = p_member;
  return t;
end $$;
revoke all on function public.assign_qr(uuid) from public, anon;
grant execute on function public.assign_qr(uuid) to authenticated;

-- Public: what a QR scan sees. Only safe fields, only for the exact token. No email.
create or replace function public.get_member_by_token(p_token text) returns json
language sql security definer stable set search_path = public as $$
  select json_build_object(
    'full_name', m.full_name, 'role', m.role, 'department', m.department, 'joined', m.created_at,
    'contributions', coalesce((
      select json_agg(json_build_object('title', c.title, 'description', c.description,
                                        'link', c.link, 'date', c.created_at) order by c.created_at desc)
      from public.contributions c where c.member_id = m.id), '[]'::json))
  from public.members m
  where m.qr_token = p_token and m.is_active;
$$;
grant execute on function public.get_member_by_token(text) to anon, authenticated;

-- Private storage bucket for uploaded QR images, admin-only
insert into storage.buckets (id, name, public) values ('qr-codes', 'qr-codes', false) on conflict do nothing;
create policy "admins manage qr files" on storage.objects for all
  using (bucket_id = 'qr-codes' and public.is_admin())
  with check (bucket_id = 'qr-codes' and public.is_admin());

-- AFTER creating your admin user in Authentication > Users, run:
-- insert into public.admins (user_id) values ('<that user uuid>');
