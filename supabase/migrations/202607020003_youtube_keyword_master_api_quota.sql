create table if not exists public.youtube_keyword_master_api_usage (
  usage_date date primary key,
  data_api_units integer not null default 0 check (data_api_units >= 0),
  search_calls integer not null default 0 check (search_calls >= 0),
  updated_at timestamptz not null default now()
);

alter table public.youtube_keyword_master_api_usage enable row level security;

create or replace function public.youtube_keyword_master_reserve_api_quota(
  p_usage_date date,
  p_units integer,
  p_search_calls integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved boolean;
begin
  if p_units < 0 or p_search_calls < 0 or p_units > 8000 or p_search_calls > 80 then
    return false;
  end if;

  insert into public.youtube_keyword_master_api_usage (
    usage_date,
    data_api_units,
    search_calls
  ) values (
    p_usage_date,
    p_units,
    p_search_calls
  )
  on conflict (usage_date) do update
    set data_api_units = public.youtube_keyword_master_api_usage.data_api_units + excluded.data_api_units,
        search_calls = public.youtube_keyword_master_api_usage.search_calls + excluded.search_calls,
        updated_at = now()
    where public.youtube_keyword_master_api_usage.data_api_units + excluded.data_api_units <= 8000
      and public.youtube_keyword_master_api_usage.search_calls + excluded.search_calls <= 80
  returning true into reserved;

  return coalesce(reserved, false);
end;
$$;

revoke all on public.youtube_keyword_master_api_usage from anon, authenticated;
revoke all on function public.youtube_keyword_master_reserve_api_quota(date, integer, integer) from public, anon, authenticated;
grant select, insert, update on public.youtube_keyword_master_api_usage to service_role;
grant execute on function public.youtube_keyword_master_reserve_api_quota(date, integer, integer) to service_role;
