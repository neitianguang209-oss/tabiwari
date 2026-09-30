import { html, React } from '../lib/html.js';
import { go, back } from '../lib/router.js';
import { createTrip, setMe } from '../lib/store.js';
import { newMemberId } from '../lib/ids.js';
import { CURRENCIES, curInfo, fetchRate, fmtRate } from '../lib/money.js';
import { Icon } from './icons.js';
import { Avatar, Sheet, toast } from './components.js';

const { useState } = React;

export const TRIP_EMOJIS = ['🧳', '✈️', '🚅', '🚗', '🏝️', '🗻', '♨️', '🏯', '🎢', '🏕️', '🌸', '🍁', '⛷️', '🍜', '🍻', '🎉'];

// 外貨を選ぶシート
export function CurrencySheet({ open, onClose, exclude = [], onPick }) {
  const list = Object.keys(CURRENCIES).filter((c) => !exclude.includes(c));
  return html`<${Sheet} open=${open} onClose=${onClose} title="通貨を追加">
    <div class="list">
      ${list.map((c) => html`<button key=${c} class="list-item" onClick=${() => { onPick(c); onClose(); }}>
        <span style=${{ fontSize: '22px' }}>${curInfo(c).flag}</span>
        <span class="grow"><span class="bold">${curInfo(c).name}</span> <span class="faint small">${c}</span></span>
        <span class="num muted">${curInfo(c).sym.trim()}</span>
      </button>`)}
    </div>
  <//>`;
}

// 外貨を足してレートを自動で取ってくる
export async function addCurrencyWithRate(cur, base = 'JPY') {
  const r = await fetchRate(cur, base);
  if (!r) return { rate: null, source: 'none', at: new Date().toISOString() };
  return { rate: r.rate, date: r.date || '', source: 'auto', at: new Date().toISOString() };
}

export function CreateTrip() {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🧳');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [myName, setMyName] = useState(() => { try { return localStorage.getItem('tabiwari:myname') || ''; } catch { return ''; } });
  const [others, setOthers] = useState([]);
  const [otherInput, setOtherInput] = useState('');
  const [currencies, setCurrencies] = useState([]);
  const [rates, setRates] = useState({});
  const [curOpen, setCurOpen] = useState(false);
  const [err, setErr] = useState('');

  function addOther() {
    const names = otherInput.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    setOthers((prev) => [...prev, ...names.filter((n) => !prev.includes(n) && n !== myName.trim())]);
    setOtherInput('');
  }

  async function addCurrency(c) {
    setCurrencies((prev) => [...prev, c]);
    setRates((prev) => ({ ...prev, [c]: { rate: null, source: 'loading' } }));
    const r = await addCurrencyWithRate(c);
    setRates((prev) => ({ ...prev, [c]: r }));
    if (!r.rate) toast(`${curInfo(c).name}のレートを取得できませんでした。あとで設定から入れられます`);
  }

  function submit(e) {
    e?.preventDefault();
    const me = myName.trim();
    if (!me) { setErr('あなたの名前を入れてください'); return; }
    const pendingOther = otherInput.trim() ? otherInput.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean) : [];
    const all = [me, ...others, ...pendingOther.filter((n) => !others.includes(n))];
    const members = all.map((n, i) => ({ id: newMemberId(), name: n, color: i % 8 }));
    const trip = {
      name: name.trim() || (start ? `${Number(start.slice(5, 7))}月の旅` : 'たび'),
      emoji,
      start: start || null,
      end: end || start || null,
      base: 'JPY',
      currencies,
      rates: Object.fromEntries(Object.entries(rates).filter(([, v]) => v.rate)),
      settle: { unit: 1, hub: null },
    };
    const id = createTrip(trip, members);
    setMe(id, members[0].id);
    try { localStorage.setItem('tabiwari:myname', me); } catch { /* 無視 */ }
    go('/t/' + id + '?share=1', { replace: true });
  }

  return html`<form class="page no-nav" onSubmit=${submit}>
    <div class="topbar">
      <button type="button" class="icon-btn" aria-label="戻る" onClick=${() => back('/')}><${Icon} name="back" /></button>
      <h1>新しい旅</h1>
    </div>

    <div class="stack">
      <div class="field">
        <label for="trip-name">旅の名前</label>
        <input id="trip-name" class="input" placeholder="例）宮崎 2泊3日" value=${name} onInput=${(e) => setName(e.target.value)} />
      </div>

      <div class="field">
        <span class="label">アイコン</span>
        <div class="emoji-grid">
          ${TRIP_EMOJIS.map((em) => html`<button type="button" key=${em} class=${em === emoji ? 'on' : ''} aria-label=${em} aria-pressed=${em === emoji} onClick=${() => setEmoji(em)}>${em}</button>`)}
        </div>
      </div>

      <div class="row">
        <div class="field grow">
          <label for="d1">行く日（任意）</label>
          <input id="d1" type="date" class="input" value=${start} onInput=${(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} />
        </div>
        <div class="field grow">
          <label for="d2">帰る日</label>
          <input id="d2" type="date" class="input" value=${end} min=${start || undefined} onInput=${(e) => setEnd(e.target.value)} />
        </div>
      </div>
    </div>

    <h2 class="section">メンバー</h2>
    <div class="card stack">
      <div class="field">
        <label for="me">あなたの名前</label>
        <div class="row">
          <${Avatar} m=${{ name: myName || '?', color: 0 }} />
          <input id="me" class="input grow" placeholder="例）ひかる" value=${myName} onInput=${(e) => { setMyName(e.target.value); setErr(''); }} />
        </div>
      </div>
      <div class="field">
        <label for="other">一緒に行く人</label>
        <div class="row">
          <input id="other" class="input grow" placeholder="名前（まとめて「ゆい、さき」もOK）" value=${otherInput}
            onInput=${(e) => setOtherInput(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addOther(); } }} />
          <button type="button" class="btn" onClick=${addOther} disabled=${!otherInput.trim()}>追加</button>
        </div>
      </div>
      ${others.length ? html`<div class="chips">
        ${others.map((n, i) => html`<span class="chip" key=${n}>
          <${Avatar} m=${{ name: n, color: (i + 1) % 8 }} size="sm" /> ${n}
          <button type="button" class="icon-btn" style=${{ width: '26px', height: '26px' }} aria-label=${n + 'を外す'}
            onClick=${() => setOthers(others.filter((x) => x !== n))}><${Icon} name="close" size=${16} /></button>
        </span>`)}
      </div>` : html`<div class="tiny faint">あとからでも追加できます。リンクを開いた人が自分で名前を足すこともできます。</div>`}
    </div>

    <h2 class="section">通貨 <span class="aside">精算は日本円</span></h2>
    <div class="card stack">
      <div class="row"><span style=${{ fontSize: '22px' }}>🇯🇵</span><span class="grow bold">日本円</span><span class="tiny faint">基準</span></div>
      ${currencies.map((c) => html`<div class="row" key=${c}>
        <span style=${{ fontSize: '22px' }}>${curInfo(c).flag}</span>
        <span class="grow"><span class="bold">${curInfo(c).name}</span>
          <span class="tiny muted" style=${{ display: 'block' }}>${rates[c]?.source === 'loading' ? 'レート取得中…' : fmtRate(c, 'JPY', rates[c]?.rate)}</span></span>
        <button type="button" class="icon-btn" aria-label="外す" onClick=${() => setCurrencies(currencies.filter((x) => x !== c))}><${Icon} name="close" size=${18} /></button>
      </div>`)}
      <button type="button" class="btn small" onClick=${() => setCurOpen(true)}><${Icon} name="globe" size=${18} />海外で使う通貨を追加</button>
    </div>

    ${err ? html`<div class="note warn" style=${{ marginTop: '16px' }}>${err}</div>` : null}

    <div class="bottom-bar"><div class="inner">
      <button type="submit" class="btn primary block">旅をつくる</button>
    </div></div>

    <${CurrencySheet} open=${curOpen} onClose=${() => setCurOpen(false)} exclude=${['JPY', ...currencies]} onPick=${addCurrency} />
  </form>`;
}
