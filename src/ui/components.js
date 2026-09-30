import { html, React } from '../lib/html.js';
import { Icon } from './icons.js';

const { useEffect, useState, useRef } = React;

// ---------------------------------------------------------------------
// メンバーの色（データ可視化の標準パレット8色。順番どおりに割り当てる）
// ---------------------------------------------------------------------
export const MEMBER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
// 背景色に対して読みやすい方（白か墨色）を選ぶ
function inkOn(hex) {
  const L = lum(hex);
  const cWhite = 1.05 / (L + 0.05);
  const cDark = (L + 0.05) / (lum('#1b1c1e') + 0.05);
  return cWhite >= cDark ? '#ffffff' : '#1b1c1e';
}
export function memberColor(m) {
  const i = Number.isInteger(m?.color) ? m.color : (m?.order ?? 0);
  return MEMBER_COLORS[((i % 8) + 8) % 8];
}
export function initial(name) {
  const s = String(name ?? '').trim();
  return s ? Array.from(s)[0].toUpperCase() : '?';
}

export function Avatar({ m, size = '', title }) {
  const c = memberColor(m);
  return html`<span class=${'avatar ' + size} style=${{ '--c': c, '--fg': inkOn(c) }} title=${title ?? m?.name} aria-hidden="true">${initial(m?.name)}</span>`;
}

export function AvatarStack({ members, max = 5, size = 'sm' }) {
  const shown = members.slice(0, max);
  return html`<span class="avatars">
    ${shown.map((m) => html`<${Avatar} key=${m.id} m=${m} size=${size} />`)}
    ${members.length > max ? html`<span class="more">+${members.length - max}</span>` : null}
  </span>`;
}

// ---------------------------------------------------------------------
// 分類
// ---------------------------------------------------------------------
export const CATEGORIES = [
  { id: 'food', label: '食事', emoji: '🍽️' },
  { id: 'move', label: '交通', emoji: '🚃' },
  { id: 'stay', label: '宿泊', emoji: '🏨' },
  { id: 'shop', label: '買い物', emoji: '🛒' },
  { id: 'fun', label: '観光・遊び', emoji: '🎡' },
  { id: 'other', label: 'その他', emoji: '📦' },
];
export const catOf = (id) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

const GUESS = [
  ['move', /タクシー|電車|バス|新幹線|JR|地下鉄|切符|きっぷ|高速|ガソリン|給油|駐車|パーキング|レンタカー|フェリー|飛行機|航空|空港|ETC|suica|pasmo|taxi|metro|uber|grab|train|bus|fuel|parking/i],
  ['stay', /ホテル|旅館|宿|民泊|airbnb|hotel|hostel|inn|ゲストハウス|温泉宿/i],
  ['food', /ランチ|ディナー|朝食|昼|夜ご飯|夕食|ごはん|ご飯|居酒屋|焼肉|寿司|すし|ラーメン|カフェ|喫茶|レストラン|食堂|バー|飲み|定食|うどん|そば|カレー|パン|スタバ|マック|ケンタ|restaurant|cafe|coffee|bar|lunch|dinner|breakfast|bbq|식당|카페/i],
  ['shop', /スーパー|コンビニ|セブン|ローソン|ファミマ|ドラッグ|薬局|ドンキ|イオン|お土産|おみやげ|土産|買い出し|market|mart|store|shop|daiso|ダイソー|올리브영|편의점/i],
  ['fun', /入場|チケット|観光|体験|水族館|動物園|美術館|博物館|遊園地|テーマパーク|ユニバ|USJ|ディズニー|温泉|銭湯|カラオケ|ボウリング|ツアー|アクティビティ|museum|ticket|tour|park/i],
];
export function guessCategory(title) {
  const t = String(title ?? '');
  for (const [id, re] of GUESS) if (re.test(t)) return id;
  return null;
}

// ---------------------------------------------------------------------
// 小物
// ---------------------------------------------------------------------
export function Seg({ options, value, onChange, small = false, label }) {
  return html`<div class=${'seg' + (small ? ' small' : '')} role="radiogroup" aria-label=${label}>
    ${options.map((o) => html`<button type="button" key=${o.value} role="radio" aria-checked=${value === o.value}
      class=${value === o.value ? 'on' : ''} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

export function Switch({ on, onChange, children, sub, label }) {
  return html`<button type="button" class=${'switch' + (on ? ' on' : '')} role="switch" aria-checked=${!!on} aria-label=${label} onClick=${() => onChange(!on)}>
    <span class="grow"><span>${children}</span>${sub ? html`<span class="tiny muted" style=${{ display: 'block', fontWeight: 500 }}>${sub}</span>` : null}</span>
    <span class="track" aria-hidden="true"></span>
  </button>`;
}

export function Stepper({ value, onChange, step = 0.5, min = 0, max = 10, format = (v) => '×' + v }) {
  const set = (v) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)));
  return html`<span class="stepper">
    <button type="button" aria-label="減らす" onClick=${() => set(value - step)}>−</button>
    <span class="v">${format(value)}</span>
    <button type="button" aria-label="増やす" onClick=${() => set(value + step)}>＋</button>
  </span>`;
}

export function Note({ kind = '', icon = 'info', children }) {
  return html`<div class=${'note ' + kind}><${Icon} name=${icon} size=${18} /><div class="grow">${children}</div></div>`;
}

// ---------------------------------------------------------------------
// 下から出るシート
// ---------------------------------------------------------------------
export function Sheet({ open, onClose, title, children, labelledBy }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => ref.current?.focus(), 30);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return html`<div>
    <div class="sheet-backdrop" onClick=${onClose}></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${title} tabindex="-1" ref=${ref}>
      <div class="grab"></div>
      ${title ? html`<div class="row between"><h3>${title}</h3>
        <button class="icon-btn" aria-label="閉じる" onClick=${onClose}><${Icon} name="close" /></button></div>` : null}
      ${children}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------
// トースト（「元に戻す」付き）
// ---------------------------------------------------------------------
let toastSeq = 0;
const toastListeners = new Set();
let toasts = [];
function setToasts(next) { toasts = next; toastListeners.forEach((f) => f(toasts)); }
export function toast(message, { action, onAction, duration = 3600 } = {}) {
  const id = ++toastSeq;
  setToasts([...toasts.slice(-2), { id, message, action, onAction }]);
  setTimeout(() => setToasts(toasts.filter((t) => t.id !== id)), duration);
}
export function ToastHost() {
  const [list, setList] = useState(toasts);
  useEffect(() => { toastListeners.add(setList); return () => toastListeners.delete(setList); }, []);
  return html`<div class="toasts" role="status" aria-live="polite">
    ${list.map((t) => html`<div class="toast" key=${t.id}>
      <span>${t.message}</span>
      ${t.action ? html`<button onClick=${() => { t.onAction?.(); setToasts(toasts.filter((x) => x.id !== t.id)); }}>${t.action}</button>` : null}
    </div>`)}
  </div>`;
}

// ---------------------------------------------------------------------
// 確認ダイアログ（Promise で結果を返す）
// ---------------------------------------------------------------------
let dialogSetter = null;
export function confirmDialog({ title, body, ok = 'OK', cancel = 'やめる', danger = false }) {
  return new Promise((resolve) => {
    if (!dialogSetter) { resolve(window.confirm(title)); return; }
    dialogSetter({ title, body, ok, cancel, danger, resolve });
  });
}
export function DialogHost() {
  const [d, setD] = useState(null);
  useEffect(() => { dialogSetter = setD; return () => { dialogSetter = null; }; }, []);
  const close = (v) => { d?.resolve(v); setD(null); };
  return html`<${Sheet} open=${!!d} onClose=${() => close(false)} title=${d?.title}>
    ${d?.body ? html`<div class="muted" style=${{ marginBottom: '16px' }}>${d.body}</div>` : null}
    <div class="row">
      <button class="btn grow" onClick=${() => close(false)}>${d?.cancel}</button>
      <button class=${'btn grow ' + (d?.danger ? 'danger' : 'primary')} onClick=${() => close(true)}>${d?.ok}</button>
    </div>
  <//>`;
}

// ---------------------------------------------------------------------
// クリップボード・共有
// ---------------------------------------------------------------------
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* 無視 */ }
    ta.remove();
    return ok;
  }
}
export function lineShareUrl(text) {
  return 'https://line.me/R/msg/text/?' + encodeURIComponent(text);
}

// 日付の表示
const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function fmtDate(s, { weekday = true, year = false } = {}) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${year ? y + '/' : ''}${m}/${d}${weekday ? `（${WD[dt.getDay()]}）` : ''}`;
}
export function dayIndex(trip, date) {
  if (!trip?.start || !date) return null;
  const a = Date.parse(trip.start + 'T00:00:00');
  const b = Date.parse(date + 'T00:00:00');
  const n = Math.round((b - a) / 864e5);
  return n >= 0 && (!trip.end || date <= trip.end) ? n + 1 : null;
}
