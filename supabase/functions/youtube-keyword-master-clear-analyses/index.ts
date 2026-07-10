import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
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

async function reuseSimilarDevice(supabase: any, code: string, deviceId: string, ip: string, userAgent: string) {
  if (!ip || !userAgent) return false;
  const { data: similar } = await supabase
    .from('youtube_keyword_master_code_devices')
    .select('id')
    .eq('code', code)
    .eq('ip', ip)
    .eq('user_agent', userAgent)
    .order('last_seen', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!similar) return false;
  await supabase
    .from('youtube_keyword_master_code_devices')
    .update({ device_id: deviceId, last_seen: new Date().toISOString(), ip, user_agent: userAgent })
    .eq('id', similar.id);
  return true;
}

async function verifyAccessCode(supabase: any, code: string, deviceId: string, ip: string, userAgent: string) {
  if (!/^[0-9]{6}$/.test(code) || !deviceId) return { ok: false, reason: 'invalid' };
  const { data: record, error } = await supabase
    .from('youtube_keyword_master_access_codes')
    .select('code, max_devices, is_active, expires_at')
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
    return { ok: true };
  }
  if (await reuseSimilarDevice(supabase, code, deviceId, ip, userAgent)) {
    return { ok: true };
  }
  const { count } = await supabase
    .from('youtube_keyword_master_code_devices')
    .select('id', { count: 'exact', head: true })
    .eq('code', code);
  if ((count || 0) >= record.max_devices) return { ok: false, reason: 'device_limit' };
  const { error: insertError } = await supabase
    .from('youtube_keyword_master_code_devices')
    .insert({ code, device_id: deviceId, ip, user_agent: userAgent });
  if (String(insertError?.code) === '23505' && await reuseSimilarDevice(supabase, code, deviceId, ip, userAgent)) {
    return { ok: true };
  }
  if (insertError && String(insertError.code) !== '23505') return { ok: false, reason: 'error' };
  return { ok: true };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  if (!isAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== 'DELETE_ALL_ANALYSES') {
    return new Response(JSON.stringify({ error: 'Confirmation is required' }), { status: 400, headers });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const adminKey = getAdminKey();
  if (!supabaseUrl || !adminKey) return new Response(JSON.stringify({ error: 'Required server secrets are missing' }), { status: 500, headers });

  const supabase = createClient(supabaseUrl, adminKey, { auth: { persistSession: false } });
  const accessCode = String(body?.code || '').trim();
  const access = await verifyAccessCode(supabase, accessCode, String(body?.deviceId || '').trim(), clientIp(request), request.headers.get('user-agent') || '');
  if (!access.ok) return new Response(JSON.stringify({ error: 'ACCESS_DENIED', reason: access.reason }), { status: 403, headers });

  const { error } = await supabase
    .from('youtube_keyword_master_analysis_results')
    .delete()
    .eq('access_code', accessCode);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });

  return new Response(JSON.stringify({ ok: true }), { headers });
});
