with ranked_devices as (
  select
    id,
    row_number() over (
      partition by code, ip, user_agent
      order by last_seen desc nulls last, first_seen desc nulls last, id desc
    ) as row_number
  from public.youtube_keyword_master_code_devices
  where coalesce(ip, '') <> ''
    and coalesce(user_agent, '') <> ''
)
delete from public.youtube_keyword_master_code_devices device
using ranked_devices ranked
where device.id = ranked.id
  and ranked.row_number > 1;

create unique index if not exists youtube_keyword_master_code_devices_signature_unique
  on public.youtube_keyword_master_code_devices (code, ip, user_agent)
  where coalesce(ip, '') <> ''
    and coalesce(user_agent, '') <> '';
