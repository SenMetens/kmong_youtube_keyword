-- 1) 오늘 API 사용량을 프런트에 노출하는 읽기 전용 뷰
--    api_usage 테이블 자체는 서비스 전용으로 잠겨 있으므로, 소유자 권한으로 실행되는
--    뷰(security_invoker 미사용)를 통해 필요한 수치만 공개한다.
--    한도 값(8000/80)은 youtube_keyword_master_reserve_api_quota의 상한과 동일하게 유지할 것.
create or replace view public.youtube_keyword_master_api_quota_status
as
select
  q.usage_date,
  q.data_api_units,
  8000 as data_api_units_limit,
  q.search_calls,
  80 as search_calls_limit
from public.youtube_keyword_master_api_usage q
where q.usage_date = (now() at time zone 'America/Los_Angeles')::date;

grant select on public.youtube_keyword_master_api_quota_status to anon, authenticated;

-- 2) 분석 결과에 채널 프로필 이미지 URL 저장
alter table public.youtube_keyword_master_analysis_results
  add column if not exists channel_thumbnail_url text not null default '';

-- 3) 좋아요 증가량은 감소(음수)도 표시해야 하므로 0 하한을 제거한다 (조회수 증가량은 유지)
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
  video.is_short,
  video.published_at,
  video.youtube_url,
  video.tags,
  current_snapshot.rank,
  current_snapshot.view_count,
  current_snapshot.like_count,
  current_snapshot.comment_count,
  greatest(current_snapshot.view_count - coalesce(previous_snapshot.view_count, current_snapshot.view_count), 0) as view_delta,
  current_snapshot.like_count - coalesce(previous_snapshot.like_count, current_snapshot.like_count) as like_delta,
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

grant select on public.youtube_keyword_master_trending_videos to anon, authenticated;
