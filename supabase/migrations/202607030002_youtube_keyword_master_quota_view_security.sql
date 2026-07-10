-- 보안 경고 해소: 쿼터 상태 뷰를 SECURITY DEFINER(소유자 권한)에서
-- security_invoker(호출자 권한)로 전환한다. 대신 api_usage 테이블에는
-- "오늘(PT 기준) 사용량 행만" 읽을 수 있는 최소 RLS 정책을 부여한다.
-- 노출되는 값은 당일 API 사용량 카운터(정수)뿐이라 민감도가 낮다.

grant select on public.youtube_keyword_master_api_usage to anon, authenticated;

drop policy if exists youtube_keyword_master_api_usage_today_read on public.youtube_keyword_master_api_usage;
create policy youtube_keyword_master_api_usage_today_read
  on public.youtube_keyword_master_api_usage
  for select to anon, authenticated
  using (usage_date = (now() at time zone 'America/Los_Angeles')::date);

create or replace view public.youtube_keyword_master_api_quota_status
with (security_invoker = true)
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
