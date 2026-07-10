-- 7일 보관 정책: 한국시간 기준 p_keep_days 이전의 스냅샷과 수집 기록을 정리한다.
-- 분석 결과(youtube_keyword_master_analysis_results)는 사용자가 저장한 자산이므로 삭제하지 않으며,
-- 분석에 연결된 영상 정보도 보존한다. 수집 함수가 매 수집 후 호출한다.
create or replace function public.youtube_keyword_master_cleanup(p_keep_days integer default 7)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_keep_days is null or p_keep_days < 1 then
    return;
  end if;

  delete from public.youtube_keyword_master_video_snapshots
  where snapshot_date < (now() at time zone 'Asia/Seoul')::date - p_keep_days;

  -- 남은 스냅샷이 참조하지 않는 오래된 수집 기록만 삭제
  delete from public.youtube_keyword_master_collection_runs runs
  where runs.started_at < now() - make_interval(days => p_keep_days)
    and not exists (
      select 1 from public.youtube_keyword_master_video_snapshots snapshot
      where snapshot.run_id = runs.id
    );

  -- 스냅샷에도 분석 결과에도 남지 않은 고아 영상 정리
  delete from public.youtube_keyword_master_videos video
  where not exists (
      select 1 from public.youtube_keyword_master_video_snapshots snapshot
      where snapshot.video_id = video.video_id
    )
    and not exists (
      select 1 from public.youtube_keyword_master_analysis_results analysis
      where analysis.video_id = video.video_id
    );
end;
$$;

revoke all on function public.youtube_keyword_master_cleanup(integer) from public, anon, authenticated;
grant execute on function public.youtube_keyword_master_cleanup(integer) to service_role;
