-- Non-destructive, member-owned import queue. No itinerary tables are changed.
begin;
create table if not exists public.trip_import_worker_config(id boolean primary key default true check(id),enabled boolean not null default false,last_heartbeat timestamptz);
insert into public.trip_import_worker_config(id) values(true) on conflict do nothing;
alter table public.trip_import_worker_config enable row level security;
revoke all on public.trip_import_worker_config from public,anon,authenticated;
create table if not exists public.trip_import_jobs(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
 idempotency_key text not null check(length(idempotency_key) between 8 and 120),
 source_url text not null check(length(source_url)<=1000 and source_url like 'https://%'),
 model text not null check(model in('metadata','qwen','llama')),options jsonb not null default '{"includeFrames":false}'::jsonb check(jsonb_typeof(options)='object' and options-'includeFrames'='{}'::jsonb and jsonb_typeof(options->'includeFrames')='boolean'),
 status text not null default 'queued' check(status in('queued','running','succeeded','failed')),
 phase text not null default '等待背景服務',raw_result jsonb,error text,
 attempts integer not null default 0 check(attempts between 0 and 2),lease_token uuid,lease_until timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(owner_id,idempotency_key),check(raw_result is null or octet_length(raw_result::text)<=200000)
);
alter table public.trip_import_jobs enable row level security;
revoke all on public.trip_import_jobs from public,anon,authenticated;
grant select on public.trip_import_jobs to authenticated;
drop policy if exists "Owner member reads import jobs" on public.trip_import_jobs;
create policy "Owner member reads import jobs" on public.trip_import_jobs for select to authenticated using(owner_id=auth.uid() and (select public.is_private_trip_member()));
create index if not exists trip_import_jobs_queue on public.trip_import_jobs(status,created_at);
-- Rate receipts survive draft deletion; callers cannot erase consumed budget.
create table if not exists public.trip_import_rate_events(owner_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now());
alter table public.trip_import_rate_events enable row level security;
revoke all on public.trip_import_rate_events from public,anon,authenticated;
create index if not exists trip_import_rate_owner on public.trip_import_rate_events(owner_id,created_at);
create or replace function public.trip_import_worker_ready() returns boolean language sql stable security definer set search_path='' as $$select coalesce((select enabled and last_heartbeat>now()-interval '20 minutes' from public.trip_import_worker_config where id),false) and public.is_private_trip_member()$$;
create or replace function public.trip_import_enqueue(p_url text,p_model text,p_key text,p_options jsonb default '{"includeFrames":false}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.trip_import_jobs;begin
 if not public.is_private_trip_member() then raise exception 'Member required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into j from public.trip_import_jobs where owner_id=auth.uid() and idempotency_key=p_key;
 if found then return to_jsonb(j)-'owner_id'-'idempotency_key'-'raw_result'-'lease_token'-'lease_until';end if;
 if not public.trip_import_worker_ready() then raise exception 'Background worker unavailable';end if;
 if p_url !~ '^https://[^/@[:space:]]+' or length(p_url)>1000 or p_model not in('metadata','qwen','llama') or length(p_key) not between 8 and 120 then raise exception 'Invalid job input';end if;
 update public.trip_import_jobs set status='failed',phase='任務逾時',error='等待或處理超過期限，請重試',updated_at=now(),lease_token=null,lease_until=null where owner_id=auth.uid() and ((status='queued' and updated_at<now()-interval '1 hour') or (status='running' and lease_until<now()));
 if (select count(*) from public.trip_import_jobs where owner_id=auth.uid() and status in('queued','running'))>=2 then raise exception 'At most 2 active import jobs';end if;
 if (select count(*) from public.trip_import_rate_events where owner_id=auth.uid() and created_at>now()-interval '10 minutes')>=5 then raise exception 'Import rate limit: 5 per 10 minutes';end if;
 delete from public.trip_import_rate_events where created_at<now()-interval '1 day';
 insert into public.trip_import_rate_events(owner_id)values(auth.uid());
 insert into public.trip_import_jobs(owner_id,idempotency_key,source_url,model,options)values(auth.uid(),p_key,p_url,p_model,p_options)returning * into j;
 return to_jsonb(j)-'owner_id'-'idempotency_key'-'raw_result'-'lease_token'-'lease_until';end$$;
create or replace function public.trip_import_retry(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare j public.trip_import_jobs;begin
 if not public.is_private_trip_member() or not public.trip_import_worker_ready() then raise exception 'Member or worker unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if(select count(*) from public.trip_import_rate_events where owner_id=auth.uid() and created_at>now()-interval '10 minutes')>=5 then raise exception 'Import rate limit: 5 per 10 minutes';end if;
 if(select count(*) from public.trip_import_jobs where owner_id=auth.uid() and status in('queued','running'))>=2 then raise exception 'At most 2 active jobs';end if;
 update public.trip_import_jobs set status='queued',phase='等待重試',error=null,raw_result=null,lease_token=null,lease_until=null,updated_at=now() where id=p_id and owner_id=auth.uid() and status='failed' and attempts<2 returning * into j;
 if not found then raise exception 'Job not retryable';end if;insert into public.trip_import_rate_events(owner_id)values(auth.uid());return to_jsonb(j)-'owner_id'-'idempotency_key'-'raw_result'-'lease_token'-'lease_until';end$$;
create or replace function public.trip_import_delete(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$begin if not public.is_private_trip_member() then raise exception 'Member required';end if;delete from public.trip_import_jobs where id=p_id and owner_id=auth.uid();return found;end$$;
create or replace function public.trip_import_expire_own() returns integer language plpgsql security definer set search_path='' as $$declare affected integer;begin
 if not public.is_private_trip_member() then raise exception 'Member required';end if;
 update public.trip_import_jobs set status='failed',phase='任務逾時',error='等待或處理超過期限，請重試',lease_token=null,lease_until=null,updated_at=now() where owner_id=auth.uid() and ((status='queued' and updated_at<now()-interval '1 hour')or(status='running' and lease_until<now()));
 get diagnostics affected=row_count;return affected;end$$;
create or replace function public.trip_import_heartbeat() returns boolean language plpgsql security definer set search_path='' as $$begin update public.trip_import_worker_config set last_heartbeat=now() where id;return found;end$$;
create or replace function public.trip_import_claim() returns jsonb language plpgsql security definer set search_path='' as $$declare j public.trip_import_jobs;begin
 perform public.trip_import_heartbeat();if not exists(select 1 from public.trip_import_worker_config where id and enabled)then return null;end if;
 update public.trip_import_jobs set status='failed',phase='任務逾時',error='等待或處理超過期限，請重試',lease_token=null,lease_until=null,updated_at=now()where(status='queued' and updated_at<now()-interval '1 hour')or(status='running' and lease_until<now());
 select * into j from public.trip_import_jobs where status='queued' and attempts<2 order by created_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.trip_import_jobs set status='running',phase='下載／字幕／語音處理中',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '15 minutes',updated_at=now()where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'url',j.source_url,'model',j.model,'options',j.options,'leaseToken',j.lease_token);end$$;
create or replace function public.trip_import_progress(p_id uuid,p_lease uuid,p_phase text) returns boolean language plpgsql security definer set search_path='' as $$begin
 if p_phase not in('extracting','captions','transcription','frame_ocr')then raise exception 'Invalid phase';end if;
 update public.trip_import_jobs set phase=p_phase,updated_at=now() where id=p_id and status='running' and lease_token=p_lease and lease_until>now();return found;end$$;
create or replace function public.trip_import_complete(p_id uuid,p_lease uuid,p_result jsonb default null,p_error text default null) returns boolean language plpgsql security definer set search_path='' as $$begin
 if p_error is null and(p_result is null or jsonb_typeof(p_result)<>'object' or coalesce(length(p_result->>'text'),0) not between 1 and 12000 or coalesce(p_result->>'type','')not in('video_caption','video_transcript','webpage','social') or octet_length(p_result::text)>200000)then raise exception 'Invalid grounded extraction result';end if;
 update public.trip_import_jobs set status=case when p_error is null then 'succeeded' else 'failed' end,phase=case when p_error is null then '來源取得完成，請整理並核對' else '來源處理失敗' end,raw_result=case when p_error is null then p_result else null end,error=left(p_error,1000),lease_token=null,lease_until=null,updated_at=now()where id=p_id and status='running' and lease_token=p_lease and lease_until>now();return found;end$$;
revoke all on function public.trip_import_worker_ready(),public.trip_import_enqueue(text,text,text,jsonb),public.trip_import_retry(uuid),public.trip_import_delete(uuid),public.trip_import_expire_own(),public.trip_import_heartbeat(),public.trip_import_claim(),public.trip_import_complete(uuid,uuid,jsonb,text),public.trip_import_progress(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.trip_import_worker_ready(),public.trip_import_enqueue(text,text,text,jsonb),public.trip_import_retry(uuid),public.trip_import_delete(uuid),public.trip_import_expire_own() to authenticated;
grant execute on function public.trip_import_heartbeat(),public.trip_import_claim(),public.trip_import_complete(uuid,uuid,jsonb,text),public.trip_import_progress(uuid,uuid,text) to service_role;
commit;
