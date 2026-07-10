-- 관리자 코드 구분용 플래그. is_admin=true 코드로 로그인하면 관리자 UI(코드 발급/조회)가 열린다.
-- idempotent: 이미 access_codes가 배포됐든 신규 배포든 안전하게 추가된다.

alter table public.youtube_keyword_master_access_codes
  add column if not exists is_admin boolean not null default false;

-- 최초 관리자 코드 부트스트랩(한 번만, SQL Editor에서 실행):
--   insert into public.youtube_keyword_master_access_codes (code, label, max_devices, is_admin)
--   values ('000000', '관리자', 99, true);
-- 이후 사용자 코드는 관리자 UI의 '코드 관리'에서 발급한다.
