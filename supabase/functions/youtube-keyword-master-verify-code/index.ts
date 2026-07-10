import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function readKeyMap(name: string) {
  const value = Deno.env.get(name);
  if (!value) return {} as Record<string, string>;
  try { return JSON.parse(value) as Record<string, string>; } catch { return {}; }
}

function isAuthorized(request: Request) {
  const provided = request.headers.get('apikey');
  const allowed = [...Object.values(readKeyMap('SUPABASE_PUBLISHABLE_KEYS')), ...Object.values(readKeyMap('SUPABASE_SECRET_KEYS'))];
  return Boolean(provided && allowed.includes(provided));
}

function getAdminKey() {
  return readKeyMap('SUPABASE_SECRET_KEYS').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

function clientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || '';
}

// 코드+기기 검증: 활성/미만료 코드인지 확인하고, 기기 토큰이 이미 바인딩돼 있으면 통과,
// 아니면 허용 기기 수 미만일 때만 새 기기를 바인딩한다. 코드 공유는 기기 수 제한으로 차단된다.
// analyze 함수와 동일 로직이지만 배포 단위가 분리되어 각 함수에 중복 정의한다.
export async function verifyAccessCode(supabase: any, code: string, deviceId: string, ip: string, userAgent: string) {
  if (!/^[0-9]{6}$/.test(code) || !deviceId) return { ok: false, reason: 'invalid' };

  const { data: record, error } = await supabase
    .from('youtube_keyword_master_access_codes')
    .select('code, max_devices, is_active, expires_at, is_admin, label')
    .eq('code', code)
    .maybeSingle();
  if (error) return { ok: false, reason: 'error' };
  if (!record || !record.is_active) return { ok: false, reason: 'invalid' };
  if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  const { data: existing } = await supabase
    .from('youtube_keyword_master_code_devices')
    .select('id')
    .eq('code', code)
    .eq('device_id', deviceId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('youtube_keyword_master_code_devices')
      .update({ last_seen: new Date().toISOString(), ip, user_agent: userAgent })
      .eq('id', existing.id);
    return { ok: true, isAdmin: record.is_admin === true, label: record.label || '' };
  }

  const { count } = await supabase
    .from('youtube_keyword_master_code_devices')
    .select('id', { count: 'exact', head: true })
    .eq('code', code);
  if ((count || 0) >= record.max_devices) return { ok: false, reason: 'device_limit' };

  const { error: insertError } = await supabase
    .from('youtube_keyword_master_code_devices')
    .insert({ code, device_id: deviceId, ip, user_agent: userAgent });
  // 동시 요청으로 unique 충돌(23505) 시엔 이미 바인딩된 것으로 보고 통과시킨다.
  if (insertError && String(insertError.code) !== '23505') return { ok: false, reason: 'error' };
  return { ok: true, isAdmin: record.is_admin === true, label: record.label || '' };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  if (!isAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

  const body = await request.json().catch(() => ({}));
  const code = String(body?.code || '').trim();
  const deviceId = String(body?.deviceId || '').trim();

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const adminKey = getAdminKey();
  if (!supabaseUrl || !adminKey) return new Response(JSON.stringify({ error: 'Required server secrets are missing' }), { status: 500, headers: corsHeaders });

  const supabase = createClient(supabaseUrl, adminKey, { auth: { persistSession: false } });
  const result = await verifyAccessCode(supabase, code, deviceId, clientIp(request), request.headers.get('user-agent') || '');
  // 검증 결과는 항상 200으로 반환한다(ok/ reason). 클라이언트가 본문만 보고 분기하도록.
  return new Response(JSON.stringify(result), { headers: corsHeaders });
});
