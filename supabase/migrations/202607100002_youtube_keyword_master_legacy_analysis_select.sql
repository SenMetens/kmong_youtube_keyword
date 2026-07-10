drop policy if exists youtube_keyword_master_analysis_public_read
  on public.youtube_keyword_master_analysis_results;

drop policy if exists youtube_keyword_master_analysis_public_no_rows
  on public.youtube_keyword_master_analysis_results;

create policy youtube_keyword_master_analysis_public_no_rows
  on public.youtube_keyword_master_analysis_results
  for select
  to anon, authenticated
  using (false);

grant select on public.youtube_keyword_master_analysis_results to anon, authenticated;
