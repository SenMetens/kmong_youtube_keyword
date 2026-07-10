do $$
declare
  item record;
begin
  for item in
    select conname
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
      ]::smallint[]
  loop
    execute format('alter table public.youtube_keyword_master_analysis_results drop constraint %I', item.conname);
  end loop;

  for item in
    select indexrelid::regclass::text as index_name
    from pg_index
    where indrelid = 'public.youtube_keyword_master_analysis_results'::regclass
      and indisunique
      and indnatts = 1
      and indnkeyatts = 1
      and indkey[0] = (
        select attnum
        from pg_attribute
        where attrelid = 'public.youtube_keyword_master_analysis_results'::regclass
          and attname = 'video_id'
      )
  loop
    execute format('drop index if exists %s', item.index_name);
  end loop;
end;
$$;

create unique index if not exists youtube_keyword_master_analysis_code_video_unique
  on public.youtube_keyword_master_analysis_results (access_code, video_id);
