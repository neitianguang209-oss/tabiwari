import { html, React } from '../lib/html.js';
import { go } from '../lib/router.js';
import { listTrips, getMe, importTrip, pendingCount } from '../lib/store.js';
import { computeBalances } from '../lib/split.js';
import { fmt } from '../lib/money.js';
import { useStore } from './hooks.js';
import { Icon } from './icons.js';
import { AvatarStack, Sheet, toast, fmtDate } from './components.js';

const { useState, useMemo, useRef } = React;

export function extractTripId(text) {
  const s = String(text ?? '').trim();
  const m = s.match(/#\/t\/([A-Za-z0-9]{12,32})/) || s.match(/^([A-Za-z0-9]{12,32})$/);
  return m ? m[1] : null;
}

function TripCard({ snap }) {
  const trip = snap.trip;
  const base = trip.base || 'JPY';
  const me = getMe(snap.id);
  const bal = useMemo(() => computeBalances(trip, snap.members, snap.expenses), [snap]);
  const net = me ? bal.members[me]?.net ?? 0 : null;
  const dates = trip.start ? `${fmtDate(trip.start, { weekday: false })}${trip.end && trip.end !== trip.start ? '〜' + fmtDate(trip.end, { weekday: false }) : ''}` : '';
  const pending = pendingCount(snap.id);
  return html`<button class="trip-card" onClick=${() => go('/t/' + snap.id)}>
    <div class="trip-emoji">${trip.emoji || '🧳'}</div>
    <div class="grow">
      <div class="bold ellipsis" style=${{ fontSize: '16px' }}>${trip.name}</div>
      <div class="row small muted" style=${{ gap: '8px', marginTop: '2px' }}>
        <${AvatarStack} members=${snap.members} max=${5} size="xs" />
        ${dates ? html`<span>${dates}</span>` : null}
        ${pending ? html`<span class="badge warn">未送信 ${pending}</span>` : null}
      </div>
    </div>
    <div style=${{ textAlign: 'right' }}>
      <div class="num bold">${fmt(bal.spent, base)}</div>
      ${net != null ? html`<div class=${'tiny bold ' + (net > 0 ? 'receive' : net < 0 ? 'pay' : 'faint')}>
        ${net > 0 ? `${fmt(net, base)} 受け取る` : net < 0 ? `${fmt(-net, base)} 払う` : '精算済み'}
      </div>` : null}
    </div>
  </button>`;
}

export function Home() {
  useStore();
  const trips = listTrips();
  const [joinOpen, setJoinOpen] = useState(false);
  const fileRef = useRef(null);

  async function onImport(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const id = importTrip(json);
      toast('バックアップから戻しました');
      go('/t/' + id);
    } catch (err) {
      toast(err.message || '読み込めませんでした');
    }
  }

  return html`<div class="page">
    <header class="brand">
      <img class="logo" src="icons/icon-192.png" alt="" />
      <div class="grow">
        <div class="name">たびわり</div>
        <div class="tiny muted">立て替えを記録して、最後にぴったり精算</div>
      </div>
    </header>

    ${trips.length
      ? html`<h2 class="section">あなたの旅 <span class="aside">${trips.length}件</span></h2>
          <div>${trips.map((s) => html`<${TripCard} key=${s.id} snap=${s} />`)}</div>`
      : html`<div class="card" style=${{ marginTop: '18px', padding: '26px 20px' }}>
          <div style=${{ fontSize: '40px' }}>🧳</div>
          <h2 style=${{ fontFamily: 'var(--font-round)', fontSize: '20px', margin: '8px 0 6px' }}>旅の立て替え、もう揉めない。</h2>
          <div class="muted small" style=${{ lineHeight: 1.8 }}>
            ・誰がいくら立て替えたか、全員のスマホで共有<br />
            ・個人の買い物が混ざっても、注文がバラバラでもOK<br />
            ・レシートを撮ればAIが品目を読み取り<br />
            ・最後は送金回数が最少になる精算プラン
          </div>
        </div>`}

    <div class="stack" style=${{ marginTop: '18px' }}>
      <button class="btn primary block" onClick=${() => go('/new')}><${Icon} name="plus" />新しい旅をつくる</button>
      <button class="btn block" onClick=${() => setJoinOpen(true)}><${Icon} name="link" />リンクで参加する</button>
      <button class="btn ghost block small" onClick=${() => fileRef.current?.click()}><${Icon} name="upload" size=${18} />バックアップから戻す</button>
      <input type="file" accept="application/json,.json" hidden ref=${fileRef} onChange=${onImport} />
    </div>

    <p class="tiny faint" style=${{ textAlign: 'center', marginTop: '28px', lineHeight: 1.7 }}>
      記録はこの端末とクラウドの両方に保存されます。<br />旅のリンクを知っている人だけが見られます。
    </p>

    <${JoinSheet} open=${joinOpen} onClose=${() => setJoinOpen(false)} />
  </div>`;
}

function JoinSheet({ open, onClose }) {
  const [text, setText] = useState('');
  const id = extractTripId(text);
  async function paste() {
    try { setText(await navigator.clipboard.readText()); } catch { toast('貼り付けできませんでした。長押しで貼り付けてください'); }
  }
  return html`<${Sheet} open=${open} onClose=${onClose} title="リンクで参加する">
    <div class="stack">
      <div class="muted small">友だちから送られてきた旅のリンクを貼り付けてください。</div>
      <input class="input" placeholder="https://…/#/t/…" value=${text} onInput=${(e) => setText(e.target.value)} />
      <div class="row">
        <button class="btn grow" onClick=${paste}><${Icon} name="copy" />貼り付け</button>
        <button class="btn primary grow" disabled=${!id} onClick=${() => { onClose(); go('/t/' + id); }}>開く</button>
      </div>
      ${text && !id ? html`<div class="small pay">リンクの形が違うようです</div>` : null}
    </div>
  <//>`;
}

export function JoinPage({ query }) {
  const id = extractTripId(query?.id ?? '');
  React.useEffect(() => { go(id ? '/t/' + id : '/', { replace: true }); }, [id]);
  return null;
}
