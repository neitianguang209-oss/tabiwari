// たびわり Edge Function
// - レシート写真を Gemini(無料枠) で読み取り、品目・金額の JSON にして返す
// - Gemini のキーはサーバー側(tabiwari_secret)だけに置く。旅行メンバーは誰でもキー無しで読み取れる
// - 認証: 旅行IDが実在すること（旅行IDを知っている＝メンバー）。verify_jwt は無効
// - 無料枠を使い切らないよう、旅行ごとに1日の回数上限を設ける
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const API = 'https://generativelanguage.googleapis.com/v1beta/';
const DAILY_CAP = 60;                 // 旅行1つあたり1日の読み取り回数
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function getSecret(k: string): Promise<string | null> {
  const { data } = await db.from('tabiwari_secret').select('v').eq('k', k).maybeSingle();
  return data?.v ?? null;
}
async function setSecret(k: string, v: string) {
  await db.from('tabiwari_secret').upsert({ k, v, updated_at: new Date().toISOString() });
}
async function tripExists(trip: unknown): Promise<boolean> {
  if (typeof trip !== 'string' || !/^[A-Za-z0-9]{12,32}$/.test(trip)) return false;
  const { data } = await db.from('tabiwari_trips').select('id').eq('id', trip).maybeSingle();
  return !!data;
}

// gemini-3.8-flash のような読み取り向きモデルを、精度の高い順(-lite は後ろ)に並べる
function orderModels(names: string[]) {
  return names
    .map((n) => {
      const m = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/.exec(n);
      return m ? { name: n, ver: parseFloat(m[1]), lite: m[2] ? 1 : 0 } : null;
    })
    .filter((m): m is { name: string; ver: number; lite: number } => !!m && m.ver >= 3)
    .sort((a, b) => a.lite - b.lite || b.ver - a.ver)
    .map((m) => m.name)
    .slice(0, 6);
}
async function listModels(key: string): Promise<{ ok: boolean; models?: string[]; status?: number }> {
  const res = await fetch(API + 'models?pageSize=1000', { headers: { 'x-goog-api-key': key } });
  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json().catch(() => null);
  const names = ((data?.models ?? []) as any[])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => String(m.name ?? '').replace(/^models\//, ''));
  const models = orderModels(names);
  return { ok: true, models: models.length ? models : FALLBACK_MODELS };
}
// モデルは入れ替わるので週1回は一覧を取り直す
async function modelsFor(key: string): Promise<string[]> {
  try {
    const raw = await getSecret('gemini_models');
    const st = raw ? JSON.parse(raw) : null;
    if (st?.models?.length && Date.now() - (st.checkedAt ?? 0) < 7 * 864e5) return st.models;
  } catch { /* 取り直す */ }
  const r = await listModels(key).catch(() => ({ ok: false } as { ok: boolean; models?: string[] }));
  if (r.ok && r.models) {
    await setSecret('gemini_models', JSON.stringify({ models: r.models, checkedAt: Date.now() }));
    return r.models;
  }
  return FALLBACK_MODELS;
}

const SYSTEM =
  'You are a meticulous receipt reader for a bill-splitting app used by Japanese travelers. ' +
  'Read the receipt photo exactly as printed and reply only with the requested JSON.';

function buildPrompt(currencies: string[]) {
  return [
    'Read this receipt (shop, supermarket, restaurant, izakaya, cafe, hotel, etc. — Japanese or foreign) and extract what is needed to split the bill among friends.',
    '',
    'Return JSON:',
    '- store: the shop name as printed ("" if unknown).',
    '- category: what kind of spending this is — "food" (restaurant, izakaya, cafe, bar, fast food, food stall), "shop" (supermarket, convenience store, drugstore, souvenirs, clothes), "move" (taxi, train, bus, fuel, parking, car rental), "stay" (hotel, inn), "fun" (tickets, admission, activities, karaoke, spa), or "other".',
    '- date: purchase date as YYYY-MM-DD ("" if not printed).',
    `- currency: ISO 4217 code of the receipt (JPY for 円/¥, KRW for 원/₩, TWD for NT$/元 in Taiwan, etc.). The travelers use: ${currencies.join(', ') || 'JPY'}.`,
    '- items: every purchased line, in printed order. Each item:',
    '    name: as printed (original language, fix nothing).',
    '    ja: a short natural Japanese name for the item (translate if not Japanese; otherwise same as name, without codes or symbols).',
    '    qty: quantity (1 if not shown).',
    '    price: the amount actually charged for that line = quantity × unit price, AFTER any discount printed right under or next to that item (subtract such a discount from that item instead of listing it separately).',
    '  Do NOT include subtotal, tax, total, payment method, cash tendered, change, points, or receipt numbers as items.',
    '- discount: discounts that apply to the whole bill (coupons, set discounts, member discounts) as a positive number; 0 if none.',
    '- tax: tax added on top of the item prices (外税). If the item prices already include tax (内税 / 税込 / (内)消費税 / VAT included), set taxIncluded true and tax 0.',
    '- service: a service charge added on top (サービス料, 봉사료, service charge); 0 if none. お通し/席料 printed as a line is an item, not service.',
    '- total: the final amount to pay (合計, お会計, 総計, TOTAL, 합계, 總計) — not the cash tendered.',
    '',
    'Numbers: plain numbers without thousands separators or currency symbols. For JPY, KRW, TWD and other currencies normally used without decimals, use integers.',
    'If a price is hard to read, give the most likely value; never skip a purchased line.',
  ].join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    store: { type: 'string' },
    category: { type: 'string', enum: ['food', 'shop', 'move', 'stay', 'fun', 'other'] },
    date: { type: 'string' },
    currency: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          ja: { type: 'string' },
          qty: { type: 'number' },
          price: { type: 'number' },
        },
        required: ['name', 'ja', 'qty', 'price'],
      },
    },
    discount: { type: 'number' },
    tax: { type: 'number' },
    service: { type: 'number' },
    total: { type: 'number' },
    taxIncluded: { type: 'boolean' },
  },
  required: ['store', 'category', 'date', 'currency', 'items', 'discount', 'tax', 'service', 'total', 'taxIncluded'],
};

// level 0: JSONの形＋考える量まで指定 / 1: JSONの形だけ / 2: 最低限。400 が返ったら1段ずつ落とす
function buildBody(image: string, mime: string, currencies: string[], level: number) {
  const body: any = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: image } }, { text: buildPrompt(currencies) }] }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192, temperature: 0 },
  };
  if (level <= 1) body.generationConfig.responseJsonSchema = SCHEMA;
  if (level === 0) body.generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
  return body;
}

function num(v: unknown): number {
  if (typeof v === 'number' && isFinite(v)) return v;
  const s = String(v ?? '').normalize('NFKC').replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function parse(data: any) {
  const cand = data?.candidates?.[0];
  if (!cand) return null;
  const text = ((cand.content?.parts ?? []) as any[])
    .filter((p) => typeof p?.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  let o: any;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || !Array.isArray(o.items)) return null;
  return {
    store: String(o.store ?? '').trim(),
    category: ['food', 'shop', 'move', 'stay', 'fun', 'other'].includes(o.category) ? o.category : '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.date ?? '')) ? String(o.date) : '',
    currency: /^[A-Z]{3}$/.test(String(o.currency ?? '').toUpperCase()) ? String(o.currency).toUpperCase() : '',
    items: (o.items as any[])
      .map((it) => ({
        name: String(it?.name ?? '').trim(),
        ja: String(it?.ja ?? '').trim(),
        qty: Math.max(1, Math.round(num(it?.qty) || 1)),
        price: num(it?.price),
      }))
      .filter((it) => it.name || it.price),
    discount: Math.abs(num(o.discount)),
    tax: num(o.tax),
    service: num(o.service),
    total: num(o.total),
    taxIncluded: !!o.taxIncluded,
  };
}

async function readReceipt(key: string, image: string, mime: string, currencies: string[]) {
  const models = await modelsFor(key);
  let last = 'server';
  for (const model of models) {
    for (let level = 0; level <= 2; level++) {
      let res: Response;
      try {
        res = await fetch(API + 'models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(buildBody(image, mime, currencies, level)),
          signal: AbortSignal.timeout(70000),
        });
      } catch {
        last = 'timeout';
        break; // 次のモデルへ
      }
      const data = await res.json().catch(() => null);
      if (res.ok) {
        const r = parse(data);
        if (r) return { ok: true, receipt: r, model };
        last = 'unreadable';
        if (level < 2) continue; // 形の指定を緩めて読み直す
        break;
      }
      const msg = String(data?.error?.message ?? '');
      if (res.status === 400 && /API[_ ]?key/i.test(msg)) return { ok: false, error: 'key' };
      if (res.status === 401 || (res.status === 403 && /API[_ ]?key|disabled/i.test(msg))) return { ok: false, error: 'key' };
      if (res.status === 400) { last = 'invalid'; continue; } // 項目が通じないモデル → 1段落とす
      if (res.status === 429) { last = 'quota'; break; }     // このモデルの無料枠切れ → 次のモデル
      last = res.status >= 500 ? 'server' : 'nomodel';
      break;
    }
  }
  return { ok: false, error: last };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'badjson' }, 400); }
  const action = body?.action;

  try {
    if (action === 'status') {
      const key = await getSecret('gemini_key');
      return json({ ok: true, ai: !!key });
    }

    if (action === 'set-key') {
      if (!(await tripExists(body.trip))) return json({ ok: false, error: 'trip' }, 403);
      const key = String(body.key ?? '').trim();
      if (!/^[A-Za-z0-9_\-]{20,120}$/.test(key)) return json({ ok: false, error: 'format' });
      const r = await listModels(key).catch(() => ({ ok: false, status: 0 } as any));
      if (!r.ok) return json({ ok: false, error: 'key', status: r.status });
      await setSecret('gemini_key', key);
      await setSecret('gemini_models', JSON.stringify({ models: r.models, checkedAt: Date.now() }));
      return json({ ok: true });
    }

    if (action === 'receipt') {
      const trip = body.trip;
      if (!(await tripExists(trip))) return json({ ok: false, error: 'trip' }, 403);
      const image = String(body.image ?? '');
      const mime = /^image\/(jpeg|png|webp)$/.test(body.mime) ? body.mime : 'image/jpeg';
      if (!image || image.length > 8_000_000) return json({ ok: false, error: 'image' }, 400);
      const key = await getSecret('gemini_key');
      if (!key) return json({ ok: false, error: 'nokey' });

      const day = new Date().toISOString().slice(0, 10);
      const { data: u } = await db.from('tabiwari_ai_usage').select('n').eq('trip_id', trip).eq('day', day).maybeSingle();
      const used = u?.n ?? 0;
      if (used >= DAILY_CAP) return json({ ok: false, error: 'cap' });
      await db.from('tabiwari_ai_usage').upsert({ trip_id: trip, day, n: used + 1 });

      const currencies = Array.isArray(body.currencies) ? body.currencies.filter((c: unknown) => typeof c === 'string').slice(0, 10) : [];
      const r = await readReceipt(key, image, mime, currencies);
      return json(r);
    }

    return json({ ok: false, error: 'action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: 'server' }, 500);
  }
});
