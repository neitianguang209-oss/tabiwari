// 通貨まわり：金額はすべて「最小単位の整数」（円・ウォンなら1、ドルならセント）で持つ。
// 浮動小数の誤差で1円ずれる、を起こさないため。

export const CURRENCIES = {
  JPY: { name: '日本円', sym: '¥', flag: '🇯🇵' },
  KRW: { name: '韓国ウォン', sym: '₩', flag: '🇰🇷' },
  TWD: { name: '台湾ドル', sym: 'NT$', flag: '🇹🇼' },
  HKD: { name: '香港ドル', sym: 'HK$', flag: '🇭🇰' },
  CNY: { name: '人民元', sym: '元', flag: '🇨🇳', after: true },
  THB: { name: 'タイバーツ', sym: '฿', flag: '🇹🇭' },
  VND: { name: 'ベトナムドン', sym: '₫', flag: '🇻🇳', after: true },
  SGD: { name: 'シンガポールドル', sym: 'S$', flag: '🇸🇬' },
  MYR: { name: 'マレーシアリンギット', sym: 'RM', flag: '🇲🇾' },
  PHP: { name: 'フィリピンペソ', sym: '₱', flag: '🇵🇭' },
  IDR: { name: 'インドネシアルピア', sym: 'Rp', flag: '🇮🇩' },
  MOP: { name: 'マカオパタカ', sym: 'MOP$', flag: '🇲🇴' },
  USD: { name: '米ドル', sym: '$', flag: '🇺🇸' },
  EUR: { name: 'ユーロ', sym: '€', flag: '🇪🇺' },
  GBP: { name: '英ポンド', sym: '£', flag: '🇬🇧' },
  CHF: { name: 'スイスフラン', sym: 'CHF ', flag: '🇨🇭' },
  AUD: { name: '豪ドル', sym: 'A$', flag: '🇦🇺' },
  NZD: { name: 'NZドル', sym: 'NZ$', flag: '🇳🇿' },
  CAD: { name: 'カナダドル', sym: 'C$', flag: '🇨🇦' },
};

// 現地で小数を使わない通貨（台湾ドルは制度上は小数ありだが、実際の値札は整数）
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'TWD', 'VND', 'IDR', 'CLP', 'ISK', 'HUF']);

export function decimals(cur) {
  return ZERO_DECIMAL.has(cur) ? 0 : 2;
}
export function curInfo(cur) {
  return CURRENCIES[cur] ?? { name: cur, sym: cur + ' ', flag: '🏳️' };
}

// 入力文字列（全角・カンマ・円記号まじりでもOK）→ 最小単位の整数。読めなければ null
export function parseAmount(input, cur) {
  if (input == null) return null;
  if (typeof input === 'number') return isFinite(input) ? Math.round(input * 10 ** decimals(cur)) : null;
  const s = String(input).normalize('NFKC').replace(/[,\s，円¥￥$€£₩₫฿]/g, '').replace(/^\+/, '');
  if (s === '' || !/^-?\d*\.?\d*$/.test(s) || s === '.' || s === '-') return null;
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return Math.round(n * 10 ** decimals(cur));
}

// 最小単位の整数 → 入力欄に入れる文字列（カンマなし）
export function toInputString(minor, cur) {
  if (minor == null || minor === '') return '';
  const d = decimals(cur);
  const v = minor / 10 ** d;
  return d ? String(Number(v.toFixed(d))) : String(Math.round(v));
}

const nfCache = new Map();
function nf(d) {
  if (!nfCache.has(d)) nfCache.set(d, new Intl.NumberFormat('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d }));
  return nfCache.get(d);
}

// 表示用。sign:true で +/− を付ける
export function fmt(minor, cur = 'JPY', opts = {}) {
  const d = decimals(cur);
  const v = Math.abs(minor ?? 0) / 10 ** d;
  // 小数通貨でも .00 のときは省く（$12 / $12.50）
  const digits = d && Math.abs(v - Math.round(v)) < 1e-9 ? 0 : d;
  const body = nf(digits).format(v);
  const info = curInfo(cur);
  const withSym = info.after ? body + info.sym : info.sym + body;
  const neg = (minor ?? 0) < 0;
  if (opts.sign) return (neg ? '−' : (minor > 0 ? '+' : '')) + withSym;
  return (neg ? '−' : '') + withSym;
}

// 数字だけ（記号なし）
export function fmtPlain(minor, cur = 'JPY') {
  const d = decimals(cur);
  const v = (minor ?? 0) / 10 ** d;
  const digits = d && Math.abs(v - Math.round(v)) < 1e-9 ? 0 : d;
  return nf(digits).format(v);
}

// 外貨の最小単位 → 基準通貨の最小単位。rate は「外貨1単位 = 基準通貨いくら」
export function convertMinor(minor, from, to, rate) {
  if (from === to) return minor;
  if (!rate || !(rate > 0)) return null;
  const v = (minor / 10 ** decimals(from)) * rate;
  return Math.round(v * 10 ** decimals(to));
}

// 表示用のレート文字列（1₩ = 0.108円 / 1$ = 149.2円）
export function fmtRate(cur, base, rate) {
  if (!rate) return '未設定';
  const b = curInfo(base);
  const digits = rate >= 100 ? 1 : rate >= 1 ? 2 : rate >= 0.01 ? 4 : 6;
  const r = Number(rate.toFixed(digits));
  return `1${curInfo(cur).sym.trim()} = ${r}${base === 'JPY' ? '円' : b.sym.trim()}`;
}

// 無料・キー不要の為替API（CORS可）を順に試す。外貨1単位あたりの基準通貨額を返す
export async function fetchRate(cur, base = 'JPY') {
  const c = cur.toLowerCase();
  const b = base.toLowerCase();
  const tries = [
    async () => {
      const r = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${c}.json`);
      const j = await r.json();
      return { rate: j?.[c]?.[b], date: j?.date };
    },
    async () => {
      const r = await fetch(`https://latest.currency-api.pages.dev/v1/currencies/${c}.json`);
      const j = await r.json();
      return { rate: j?.[c]?.[b], date: j?.date };
    },
    async () => {
      const r = await fetch(`https://open.er-api.com/v6/latest/${cur}`);
      const j = await r.json();
      return { rate: j?.rates?.[base], date: j?.time_last_update_utc ? new Date(j.time_last_update_utc).toISOString().slice(0, 10) : '' };
    },
  ];
  for (const t of tries) {
    try {
      const out = await Promise.race([t(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
      if (out.rate > 0) return out;
    } catch { /* 次を試す */ }
  }
  return null;
}
