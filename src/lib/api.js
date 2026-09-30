import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, FN_URL } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 5 } },
});

export class NetError extends Error {
  constructor(message, kind = 'network') { super(message); this.kind = kind; }
}

function wrap(error) {
  const msg = String(error?.message ?? error ?? '');
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return new NetError(msg, 'network');
  if (/trip not found/i.test(msg)) return new NetError(msg, 'notrip');
  return new NetError(msg, 'server');
}

export async function rpcPull(tripId, since) {
  if (navigator.onLine === false) throw new NetError('offline', 'network');
  const { data, error } = await supabase.rpc('tabiwari_pull', { p_trip: tripId, p_since: since ?? null });
  if (error) throw wrap(error);
  return data;
}

export async function rpcPush(tripId, ops) {
  if (navigator.onLine === false) throw new NetError('offline', 'network');
  const { data, error } = await supabase.rpc('tabiwari_push_batch', { p_trip: tripId, p_ops: ops });
  if (error) throw wrap(error);
  return data;
}

// Edge Function（AI読み取りなど）
export async function callFn(action, body = {}, { timeout = 90000 } = {}) {
  if (navigator.onLine === false) throw new NetError('offline', 'network');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!data) throw new NetError('bad response ' + res.status, 'server');
    return data;
  } catch (e) {
    if (e instanceof NetError) throw e;
    if (e?.name === 'AbortError') throw new NetError('timeout', 'timeout');
    throw wrap(e);
  } finally {
    clearTimeout(timer);
  }
}
