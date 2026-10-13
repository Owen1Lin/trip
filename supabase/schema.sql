-- Run in your own Supabase project's SQL editor before enabling cloud sync.
create table if not exists public.trip_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trips jsonb not null default '[]'::jsonb check (jsonb_typeof(trips) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.trip_snapshots enable row level security;
revoke all on public.trip_snapshots from anon;
grant select, insert, update, delete on public.trip_snapshots to authenticated;

drop policy if exists "Read own travel snapshot" on public.trip_snapshots;
create policy "Read own travel snapshot" on public.trip_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Insert own travel snapshot" on public.trip_snapshots;
create policy "Insert own travel snapshot" on public.trip_snapshots
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Update own travel snapshot" on public.trip_snapshots;
create policy "Update own travel snapshot" on public.trip_snapshots
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Delete own travel snapshot" on public.trip_snapshots;
create policy "Delete own travel snapshot" on public.trip_snapshots
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.set_trip_snapshot_timestamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trip_snapshot_timestamp on public.trip_snapshots;
create trigger trip_snapshot_timestamp before update on public.trip_snapshots
  for each row execute function public.set_trip_snapshot_timestamp();
