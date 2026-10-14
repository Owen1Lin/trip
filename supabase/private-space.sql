-- Supabase SQL Editor migration. Fill both Gmail placeholders before running.
-- Setup also supplies a filled copy outside Git to keep addresses private.
begin;
do $$ begin
  if 'replace-owen@gmail.com' like 'replace-%' or 'replace-winnie@gmail.com' like 'replace-%' then
    raise exception '請使用已填入兩個 Gmail 的專屬設定檔，或先替換兩個 placeholder。';
  end if;
end $$;
create table if not exists public.private_trip_members (
  email text primary key check (email = lower(email) and email ~ '^[^@ ]+@gmail\.com$'),
  display_name text not null,
  actor text not null unique check (actor in ('owen', 'winnie'))
);
alter table public.private_trip_members enable row level security;
revoke all on public.private_trip_members from anon, authenticated;
grant select on public.private_trip_members to authenticated;

insert into public.private_trip_members (email, display_name, actor) values
  ('replace-owen@gmail.com', '歐文', 'owen'),
  ('replace-winnie@gmail.com', '溫妮', 'winnie')
on conflict (email) do update set display_name = excluded.display_name, actor = excluded.actor;

create or replace function public.is_private_trip_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce((auth.jwt() -> 'amr') @> '[{"method":"oauth"}]'::jsonb, false)
    and exists (
      select 1 from public.private_trip_members m
      join auth.users u on u.id = auth.uid() and lower(u.email) = m.email
      join auth.identities i on i.user_id = u.id and i.provider = 'google'
      where m.email = lower(auth.jwt() ->> 'email')
        and u.email_confirmed_at is not null
        and lower(i.identity_data ->> 'email') = m.email
    );
$$;
revoke all on function public.is_private_trip_member() from public, anon;
grant execute on function public.is_private_trip_member() to authenticated;

drop policy if exists "Read own private membership" on public.private_trip_members;
create policy "Read own private membership" on public.private_trip_members
  for select to authenticated using (
    email = lower(auth.jwt() ->> 'email') and (select public.is_private_trip_member())
  );

create table if not exists public.shared_trip_snapshots (
  scope text primary key check (scope = 'owen-winnie-20261021'),
  trips jsonb not null check (coalesce((
    jsonb_typeof(trips) = 'array' and jsonb_array_length(trips) = 1
    and trips -> 0 ->> 'id' = 'fukuoka-20261021'
    and trips -> 0 ->> 'startDate' = '2026-10-21'
    and trips -> 0 ->> 'dayCount' = '5'
    and jsonb_typeof(trips -> 0 -> 'days') = 'array'
    and jsonb_array_length(trips -> 0 -> 'days') = 5
  ), false)),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.shared_trip_snapshots enable row level security;
revoke all on public.shared_trip_snapshots from anon, authenticated;
grant select, insert, update on public.shared_trip_snapshots to authenticated;
drop policy if exists "Members read shared trip" on public.shared_trip_snapshots;
create policy "Members read shared trip" on public.shared_trip_snapshots
  for select to authenticated using ((select public.is_private_trip_member()));
drop policy if exists "Members insert shared trip" on public.shared_trip_snapshots;
create policy "Members insert shared trip" on public.shared_trip_snapshots
  for insert to authenticated with check ((select public.is_private_trip_member()));
drop policy if exists "Members update shared trip" on public.shared_trip_snapshots;
create policy "Members update shared trip" on public.shared_trip_snapshots
  for update to authenticated using ((select public.is_private_trip_member()))
  with check ((select public.is_private_trip_member()));

create or replace function public.stamp_private_trip_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = clock_timestamp();
  new.updated_by = auth.uid();
  return new;
end;
$$;
drop trigger if exists stamp_private_trip_update on public.shared_trip_snapshots;
create trigger stamp_private_trip_update before insert or update on public.shared_trip_snapshots
  for each row execute function public.stamp_private_trip_update();

insert into public.shared_trip_snapshots (scope, trips) values (
  'owen-winnie-20261021',
  '[{"id":"fukuoka-20261021","name":"福岡＆九州五日旅行","destination":"福岡＆九州","startDate":"2026-10-21","dayCount":5,"days":[[],[],[],[],[]]}]'::jsonb
) on conflict (scope) do nothing;

-- Keep the old records and their per-user policies, adding an internal-only rule.
do $$ begin
  if to_regclass('public.trip_snapshots') is not null then
    execute 'drop policy if exists "Internal members only" on public.trip_snapshots';
    execute 'create policy "Internal members only" on public.trip_snapshots as restrictive
      for all to authenticated using ((select public.is_private_trip_member()))
      with check ((select public.is_private_trip_member()))';
  end if;
end $$;
commit;
