-- 분석 결과에 카테고리를 저장해 상세 화면에 표시한다.
alter table public.youtube_keyword_master_analysis_results
  add column if not exists category_key text not null default '';
