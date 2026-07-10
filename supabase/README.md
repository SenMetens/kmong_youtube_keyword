# Supabase 배포

모든 프로젝트 테이블, 뷰, 정책, 함수 이름은 `youtube_keyword_master_` 접두사를 사용합니다.

## 1. CLI 연결

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

`YOUR_PROJECT_REF`는 Supabase Project URL의 서브도메인입니다.

## 2. 데이터베이스 반영

```bash
npx supabase db push
```

CLI를 사용하지 않을 경우 Dashboard의 SQL Editor에서 `migrations/202607020001_youtube_keyword_master_schema.sql` 내용을 실행할 수 있습니다.

## 3. YouTube 키 등록

Dashboard의 Edge Functions → Secrets에서 다음 값을 추가합니다.

```text
YOUTUBE_API_KEY=Google Cloud에서 발급한 키
```

키는 프로젝트 파일이나 브라우저 환경변수에 저장하지 않습니다.

## 4. Edge Function 배포

```bash
npx supabase functions deploy youtube-keyword-master-collect
npx supabase functions deploy youtube-keyword-master-analyze
npx supabase functions deploy youtube-keyword-master-verify-code
npx supabase functions deploy youtube-keyword-master-admin
```

## 5. 최초 수집 및 수집 예약 (하루 6회)

수집 주기는 코드가 아니라 이 Cron Job이 결정합니다. Dashboard의 Integrations → Cron에서 Job을 만듭니다.

- 이름: `youtube-keyword-master-collect-6x`
- 일정: `5 3,7,11,15,19,23 * * *` (UTC 기준 = 한국 시간 00:05, 04:05, 08:05, 12:05, 16:05, 20:05 — 4시간 슬롯당 1회)
- 유형: Supabase Edge Function
- 함수: `youtube-keyword-master-collect`
- 메서드: POST
- 본문: `{}`

검색 발견 트랙: 함수 코드의 `DISCOVERY_SLOT_HOURS_KST`(기본 한국 시간 08시·20시 슬롯)에서만 카테고리별 `search.list` 발견이 실행됩니다(검색 1회 = 100유닛). 커스텀 주제 발견은 기본 한국 시간 20시에만 실행되며, Edge Function Secret `TOPIC_DISCOVERY_SLOT_HOURS_KST`에 `16,20`처럼 쉼표로 시간을 넣으면 수기로 바꿀 수 있습니다. 나머지 슬롯은 차트 수집과 발견 영상 이어추적(`videos.list`, 50개당 1유닛)만 수행하므로 쿼터가 절약됩니다.

기존에 하루 1회 일정(`0 21 * * *`)으로 만든 Job이 있다면 위 일정으로 수정하거나 삭제 후 새로 만듭니다. 같은 4시간 슬롯에서 이미 수집이 완료된 경우 함수가 자동으로 건너뜁니다.

생성 후 `Run now`로 최초 수집을 실행합니다. 서버 간 호출 인증에는 Supabase Secret key를 사용하며, 이 값은 브라우저나 Git에 저장하지 않습니다.

## 6. 관리자 코드 부트스트랩

서비스는 6자리 접근 코드로 잠겨 있습니다. 사용자 코드는 관리자 UI에서 발급하지만, **최초 관리자 코드 1개**만 SQL Editor에서 한 번 넣어 부트스트랩합니다.

```sql
insert into public.youtube_keyword_master_access_codes (code, label, max_devices, is_admin)
values ('000000', '관리자', 99, true);
```

- `is_admin = true`인 코드로 로그인하면 상단 메뉴에 **코드 관리**가 나타납니다.
- 관리자 코드는 여러 기기에서 쓰도록 `max_devices`를 넉넉히(예: 99) 둡니다.
- `000000`은 예시이며, 추측하기 어려운 값으로 바꾸세요.

## 7. 사용자 코드 발급 (관리자 UI)

관리자 코드로 로그인한 뒤 **코드 관리** 메뉴에서:

- 닉네임과 허용 기기 수(기본 2)를 입력하고 **코드 발급**을 누르면 6자리 코드가 자동 생성되어 DB에 저장됩니다. 이 코드를 사용자에게 전달합니다.
- 발급된 코드 목록에서 각 코드로 접속한 **기기 수·IP·브라우저·마지막 접속 시각**을 볼 수 있습니다(사용자가 코드로 접속하면 자동 기록).
- 코드별 **사용중/중지** 토글로 즉시 차단할 수 있습니다.

허용 기기 수를 넘겨 새 기기가 접속을 시도하면 인증이 거부되므로, 코드 공유가 제한됩니다. 접근 코드 검증·발급은 모두 Edge Function이 service role로 **서버에서 강제**하며(개발자도구 우회 불가), 코드/기기 테이블은 RLS로 anon 접근이 차단되어 코드 값이 클라이언트에 노출되지 않습니다.

## 생성되는 데이터베이스 객체

- `youtube_keyword_master_videos`
- `youtube_keyword_master_video_snapshots`
- `youtube_keyword_master_analysis_results`
- `youtube_keyword_master_collection_runs`
- `youtube_keyword_master_access_codes`
- `youtube_keyword_master_code_devices`
- `youtube_keyword_master_trending_videos` (view)
- `youtube_keyword_master_dashboard_summary` (view)
