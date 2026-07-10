-- 1) Shorts 판별: 세로(embedHeight > embedWidth) 여부를 수집 시 저장
--    null = 아직 판별 전(다음 수집에서 채워짐)
alter table public.youtube_keyword_master_videos
  add column if not exists is_short boolean;

-- 2) 스냅샷을 "하루 1건"이 아니라 "수집(run) 1건"으로 저장하도록 변경
--    기존 unique (video_id, category_key, snapshot_date)는 같은 날 두 번째 수집이
--    직전 값을 덮어써서 직전 수집 대비 증가량을 계산할 수 없게 만들므로 제거한다.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.youtube_keyword_master_video_snapshots'::regclass
    and contype = 'u';
  if cname is not null then
    execute format('alter table public.youtube_keyword_master_video_snapshots drop constraint %I', cname);
  end if;
end;
$$;

create unique index if not exists youtube_keyword_master_snapshots_run_unique
  on public.youtube_keyword_master_video_snapshots (video_id, category_key, run_id);

-- 직전 스냅샷 조회용 인덱스
create index if not exists youtube_keyword_master_snapshots_prev_lookup_idx
  on public.youtube_keyword_master_video_snapshots (video_id, category_key, collected_at desc);

-- 3) 뷰 재생성: 컬럼 추가(is_short)와 델타 기준 변경(전일 → 직전 수집)
--    create or replace로는 컬럼 추가가 불가능해 drop 후 재생성한다.
drop view if exists public.youtube_keyword_master_dashboard_summary;
drop view if exists public.youtube_keyword_master_trending_videos;

create view public.youtube_keyword_master_trending_videos
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
  video.is_short,
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
left join lateral (
  -- 직전 수집: 완료된 run 중 현재 스냅샷보다 먼저 수집된 가장 최근 스냅샷
  select prev.view_count, prev.like_count
  from public.youtube_keyword_master_video_snapshots prev
  join public.youtube_keyword_master_collection_runs prev_run
    on prev_run.id = prev.run_id
   and prev_run.status = 'completed'
  where prev.video_id = current_snapshot.video_id
    and prev.category_key = current_snapshot.category_key
    and prev.run_id is distinct from current_snapshot.run_id
    and prev.collected_at < current_snapshot.collected_at
  order by prev.collected_at desc
  limit 1
) previous_snapshot on true;

create view public.youtube_keyword_master_dashboard_summary
with (security_invoker = true)
as
select
  (select count(*) from public.youtube_keyword_master_trending_videos) as current_video_count,
  (select count(distinct snapshot_date) from public.youtube_keyword_master_video_snapshots) as snapshot_days,
  (select max(collected_at) from public.youtube_keyword_master_video_snapshots) as last_collected_at,
  (select count(*) from public.youtube_keyword_master_analysis_results) as analysis_count;

grant select on public.youtube_keyword_master_trending_videos to anon, authenticated;
grant select on public.youtube_keyword_master_dashboard_summary to anon, authenticated;
