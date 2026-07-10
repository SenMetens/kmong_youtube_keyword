alter table public.youtube_keyword_master_analysis_results
  add column if not exists access_code text not null default '';

alter table public.youtube_keyword_master_analysis_results
  drop constraint if exists youtube_keyword_master_analysis_results_video_id_key;

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.youtube_keyword_master_analysis_results'::regclass
    and contype = 'u'
    and conkey = array[
      (
        select attnum
        from pg_attribute
        where attrelid = 'public.youtube_keyword_master_analysis_results'::regclass
          and attname = 'video_id'
      )
    ]::smallint[];

  if constraint_name is not null then
    execute format('alter table public.youtube_keyword_master_analysis_results drop constraint %I', constraint_name);
  end if;
end;
$$;

create unique index if not exists youtube_keyword_master_analysis_code_video_unique
  on public.youtube_keyword_master_analysis_results (access_code, video_id);

create index if not exists youtube_keyword_master_analysis_access_code_idx
  on public.youtube_keyword_master_analysis_results (access_code, analyzed_at desc);

drop policy if exists youtube_keyword_master_analysis_public_read
  on public.youtube_keyword_master_analysis_results;

revoke select on public.youtube_keyword_master_analysis_results from anon, authenticated;
grant select, insert, update, delete on public.youtube_keyword_master_analysis_results to service_role;

create or replace view public.youtube_keyword_master_dashboard_summary
with (security_invoker = true)
as
select
  (select count(*) from public.youtube_keyword_master_trending_videos) as current_video_count,
  (select count(distinct snapshot_date) from public.youtube_keyword_master_video_snapshots) as snapshot_days,
  (select max(collected_at) from public.youtube_keyword_master_video_snapshots) as last_collected_at,
  0::bigint as analysis_count;

grant select on public.youtube_keyword_master_dashboard_summary to anon, authenticated;
