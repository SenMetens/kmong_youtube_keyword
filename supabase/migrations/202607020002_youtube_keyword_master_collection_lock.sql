create unique index if not exists youtube_keyword_master_collection_runs_running_once
  on public.youtube_keyword_master_collection_runs (collection_date)
  where status = 'running';
