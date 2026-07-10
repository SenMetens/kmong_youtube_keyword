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

// 관리자 검증: 활성/미만료 + is_admin=true 코드이고, 그 기기가 실제로 바인딩(로그인)돼 있어야 한다.
async function verifyAdmin(supabase: any, code: string, deviceId: string) {
  if (!/^[0-9]{6}$/.test(code) || !deviceId) return false;
  const { data: record } = await supabase
    .from('youtube_keyword_master_access_codes')
    .select('code, is_active, expires_at, is_admin')
    .eq('code', code)
    .maybeSingle();
  if (!record || !record.is_active || record.is_admin !== true) return false;
  if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) return false;
  const { data: device } = await supabase
    .from('youtube_keyword_master_code_devices')
    .select('id')
    .eq('code', code)
    .eq('device_id', deviceId)
    .maybeSingle();
  return Boolean(device);
}

// 중복되지 않는 6자리 코드를 생성한다.
async function generateUniqueCode(supabase: any): Promise<string | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = String(Math.floor(100000 + Math.random() * 900000));
    const { data } = await supabase
      .from('youtube_keyword_master_access_codes')
      .select('code')
      .eq('code', candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  if (!isAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

  const body = await request.json().catch(() => ({}));
  const code = String(body?.code || '').trim();
  const deviceId = String(body?.deviceId || '').trim();
  const action = String(body?.action || '').trim();

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const adminKey = getAdminKey();
  if (!supabaseUrl || !adminKey) return new Response(JSON.stringify({ error: 'Required server secrets are missing' }), { status: 500, headers: corsHeaders });

  const supabase = createClient(supabaseUrl, adminKey, { auth: { persistSession: false } });

  // 모든 관리자 동작은 서버에서 관리자 코드를 재검증한 뒤에만 수행된다.
  if (!await verifyAdmin(supabase, code, deviceId)) {
    return new Response(JSON.stringify({ error: 'ADMIN_REQUIRED' }), { status: 403, headers: corsHeaders });
  }

  if (action === 'issue') {
    const label = String(body?.label || '').trim().slice(0, 60);
    const maxDevices = Math.max(1, Math.min(50, Number(body?.maxDevices) || 2));
    const newCode = await generateUniqueCode(supabase);
    if (!newCode) return new Response(JSON.stringify({ error: 'code_generation_failed' }), { status: 500, headers: corsHeaders });
    const { error } = await supabase
      .from('youtube_keyword_master_access_codes')
      .insert({ code: newCode, label, max_devices: maxDevices, is_admin: false });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true, code: newCode, label, maxDevices }), { headers: corsHeaders });
  }

  if (action === 'list') {
    const { data: codes, error } = await supabase
      .from('youtube_keyword_master_access_codes')
      .select('code, label, max_devices, is_active, created_at')
      .eq('is_admin', false)
      .order('created_at', { ascending: false });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    const { data: devices } = await supabase
      .from('youtube_keyword_master_code_devices')
      .select('code, ip, user_agent, first_seen, last_seen')
      .order('last_seen', { ascending: false });
    const byCode: Record<string, any[]> = {};
    (devices || []).forEach((device: any) => { (byCode[device.code] = byCode[device.code] || []).push(device); });
    const result = (codes || []).map((item: any) => ({ ...item, devices: byCode[item.code] || [] }));
    return new Response(JSON.stringify({ ok: true, codes: result }), { headers: corsHeaders });
  }

  if (action === 'set_active') {
    const targetCode = String(body?.targetCode || '').trim();
    if (!/^[0-9]{6}$/.test(targetCode)) return new Response(JSON.stringify({ error: 'invalid_target' }), { status: 400, headers: corsHeaders });
    const { error } = await supabase
      .from('youtube_keyword_master_access_codes')
      .update({ is_active: Boolean(body?.isActive) })
      .eq('code', targetCode)
      .eq('is_admin', false); // 관리자 코드는 이 경로로 변경할 수 없다.
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  if (action === 'set_max_devices') {
    const targetCode = String(body?.targetCode || '').trim();
    const maxDevices = Math.max(1, Math.min(50, Number(body?.maxDevices) || 1));
    if (!/^[0-9]{6}$/.test(targetCode)) return new Response(JSON.stringify({ error: 'invalid_target' }), { status: 400, headers: corsHeaders });
    const { error } = await supabase
      .from('youtube_keyword_master_access_codes')
      .update({ max_devices: maxDevices })
      .eq('code', targetCode)
      .eq('is_admin', false);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true, maxDevices }), { headers: corsHeaders });
  }

  if (action === 'reset_devices') {
    const targetCode = String(body?.targetCode || '').trim();
    if (!/^[0-9]{6}$/.test(targetCode)) return new Response(JSON.stringify({ error: 'invalid_target' }), { status: 400, headers: corsHeaders });
    // 관리자 코드의 기기는 이 경로로 초기화하지 않는다.
    const { data: target } = await supabase
      .from('youtube_keyword_master_access_codes')
      .select('code, is_admin')
      .eq('code', targetCode)
      .maybeSingle();
    if (!target || target.is_admin) return new Response(JSON.stringify({ error: 'invalid_target' }), { status: 400, headers: corsHeaders });
    const { error } = await supabase
      .from('youtube_keyword_master_code_devices')
      .delete()
      .eq('code', targetCode);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  if (action === 'delete_code') {
    const targetCode = String(body?.targetCode || '').trim();
    if (!/^[0-9]{6}$/.test(targetCode)) return new Response(JSON.stringify({ error: 'invalid_target' }), { status: 400, headers: corsHeaders });
    // 관리자 코드는 삭제하지 않는다.
    const { data: target } = await supabase
      .from('youtube_keyword_master_access_codes')
      .select('code, is_admin')
      .eq('code', targetCode)
      .maybeSingle();
    if (!target || target.is_admin) return new Response(JSON.stringify({ error: 'invalid_target' }), { status: 400, headers: corsHeaders });
    // 연결된 기기를 먼저 지운 뒤 코드를 삭제한다(FK on delete cascade가 없는 환경에서도 안전).
    await supabase.from('youtube_keyword_master_code_devices').delete().eq('code', targetCode);
    const { error } = await supabase.from('youtube_keyword_master_access_codes').delete().eq('code', targetCode);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: 'unknown_action' }), { status: 400, headers: corsHeaders });
});
