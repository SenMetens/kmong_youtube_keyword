alter table public.youtube_keyword_master_collection_runs
  add column if not exists collection_slot timestamptz;

update public.youtube_keyword_master_collection_runs
set collection_slot = started_at
where collection_slot is null;

alter table public.youtube_keyword_master_collection_runs
  alter column collection_slot set not null;

create unique index if not exists youtube_keyword_master_collection_runs_slot_once
  on public.youtube_keyword_master_collection_runs (collection_slot)
  where status in ('running', 'completed');

alter table public.youtube_keyword_master_video_snapshots
  add column if not exists run_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'youtube_keyword_master_video_snapshots_run_id_fkey'
  ) then
    alter table public.youtube_keyword_master_video_snapshots
      add constraint youtube_keyword_master_video_snapshots_run_id_fkey
      foreign key (run_id)
      references public.youtube_keyword_master_collection_runs(id)
      on delete set null;
  end if;
end;
$$;

with latest_completed_run as (
  select distinct on (collection_date)
    id,
    collection_date
  from public.youtube_keyword_master_collection_runs
  where status = 'completed'
  order by collection_date, completed_at desc nulls last
)
update public.youtube_keyword_master_video_snapshots snapshot
set run_id = latest_completed_run.id
from latest_completed_run
where snapshot.snapshot_date = latest_completed_run.collection_date
  and snapshot.run_id is null;

create index if not exists youtube_keyword_master_video_snapshots_run_id_idx
  on public.youtube_keyword_master_video_snapshots (run_id, rank);

create or replace view public.youtube_keyword_master_trending_videos
with (security_invoker = true)
as
with latest_completed_run as (
  select id
  from public.youtube_keyword_master_collection_runs
  where status = 'completed'
  order by completed_at desc nulls last
  limit 1
), current_snapshot as (
  select snapshot.*
  from public.youtube_keyword_master_video_snapshots snapshot
  join latest_completed_run run on run.id = snapshot.run_id
)
select
  video.video_id,
  current_snapshot.category_key,
  video.youtube_category_id,
  video.channel_id,
  video.channel_title,
  video.title,
  video.description,
  video.thumbnail_url,
  video.duration_iso8601,
  video.duration_seconds,
  video.duration_display,
  video.published_at,
  video.youtube_url,
  video.tags,
  current_snapshot.rank,
  current_snapshot.view_count,
  current_snapshot.like_count,
  current_snapshot.comment_count,
  greatest(current_snapshot.view_count - coalesce(previous_snapshot.view_count, current_snapshot.view_count), 0) as view_delta,
  greatest(current_snapshot.like_count - coalesce(previous_snapshot.like_count, current_snapshot.like_count), 0) as like_delta,
  current_snapshot.snapshot_date,
  current_snapshot.collected_at
from current_snapshot
join public.youtube_keyword_master_videos video on video.video_id = current_snapshot.video_id
left join public.youtube_keyword_master_video_snapshots previous_snapshot
  on previous_snapshot.video_id = current_snapshot.video_id
 and previous_snapshot.category_key = current_snapshot.category_key
 and previous_snapshot.snapshot_date = current_snapshot.snapshot_date - 1;

grant select on public.youtube_keyword_master_trending_videos to anon, authenticated;
