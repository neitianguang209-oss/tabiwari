import { html, React } from '../lib/html.js';
import { back, go } from '../lib/router.js';
import { openTrip, closeTrip } from '../lib/store.js';
import { fmt } from '../lib/money.js';
import { explainShare } from '../lib/report.js';
import { useTripData } from './hooks.js';
import { Icon } from './icons.js';
import { Avatar, catOf, fmtDate } from './components.js';

const { useEffect } = React;

// ひとりの「立て替えた」「使った」を1件ずつ。なぜこの金額になったかも添える
export function MemberPage({ tripId, memberId }) {
  useEffect(() => { openTrip(tripId); return () => closeTrip(tripId); }, [tripId]);
  const { snap, bal, me } = useTripData(tripId);
  if (!snap?.trip || !bal) return html`<div class="page"><div class="empty"><div class="e">⏳</div>読み込んでいます…</div></div>`;
  const m = snap.memberById.get(memberId);
  const base = snap.trip.base || 'JPY';
  const b = bal.members[memberId] ?? { paid: 0, share: 0, net: 0, transferIn: 0, transferOut: 0 };

  const rows = snap.expenses
    .map((x) => ({ x, r: bal.perExpense.get(x.id) }))
    .filter(({ x, r }) => r && !r.problem && (x.kind === 'transfer' ? x.from === memberId || x.to === memberId : r.paid[memberId] || r.shares[memberId]));

  return html`<div class="page no-nav">
    <div class="topbar">
      <button class="icon-btn" aria-label="戻る" onClick=${() => back(`/t/${tripId}/settle`)}><${Icon} name="back" /></button>
      <h1>${m?.name ?? '?'}${memberId === me ? '（あなた）' : ''}</h1>
    </div>

    <div class="hero">
      <div class="row">
        <${Avatar} m=${m} size="lg" />
        <div class="grow">
          <div class="label">${b.net > 0 ? '精算で受け取る' : b.net < 0 ? '精算で払う' : '精算'}</div>
          <div class=${'big ' + (b.net > 0 ? 'receive' : b.net < 0 ? 'pay' : '')}>${b.net ? fmt(Math.abs(b.net), base) : '±0'}</div>
        </div>
      </div>
      <div class="hero-split">
        <div class="me-box"><div class="label">立て替えた</div><div class="v num">${fmt(b.paid, base)}</div></div>
        <div class="me-box"><div class="label">使った（負担）</div><div class="v num">${fmt(b.share, base)}</div></div>
      </div>
      ${b.transferIn || b.transferOut ? html`<div class="tiny muted" style=${{ marginTop: '10px' }}>
        精算の送金：${b.transferOut ? `送った ${fmt(b.transferOut, base)}` : ''}${b.transferOut && b.transferIn ? ' / ' : ''}${b.transferIn ? `受け取った ${fmt(b.transferIn, base)}` : ''}
      </div>` : null}
      <div class="tiny muted" style=${{ marginTop: '6px' }}>
        ${fmt(b.paid, base)} − ${fmt(b.share, base)}${b.transferOut ? ` ＋ ${fmt(b.transferOut, base)}` : ''}${b.transferIn ? ` − ${fmt(b.transferIn, base)}` : ''} ＝ <b>${fmt(b.net, base, { sign: true })}</b>
      </div>
    </div>

    <h2 class="section">1件ずつ <span class="aside">${rows.length}件</span></h2>
    ${rows.length ? html`<div class="list">
      ${rows.map(({ x, r }) => {
        if (x.kind === 'transfer') {
          const out = x.from === memberId;
          return html`<button class="exp transfer" key=${x.id} onClick=${() => go(`/t/${tripId}/e/${x.id}`)}>
            <div class="cat"><${Icon} name="settle" size=${20} /></div>
            <div class="grow" style=${{ minWidth: 0 }}>
              <div class="t ellipsis">${out ? `${snap.memberById.get(x.to)?.name}へ送金` : `${snap.memberById.get(x.from)?.name}から受け取り`}</div>
              <div class="sub">${fmtDate(x.date)}</div>
            </div>
            <div class="amt"><div class="v">${fmt(x.amount, base)}</div></div>
          </button>`;
        }
        const paid = r.paid[memberId] ?? 0;
        const share = r.shares[memberId] ?? 0;
        return html`<button class="exp" key=${x.id} onClick=${() => go(`/t/${tripId}/e/${x.id}`)}>
          <div class="cat">${catOf(x.category).emoji}</div>
          <div class="grow" style=${{ minWidth: 0 }}>
            <div class="t ellipsis">${x.title || catOf(x.category).label}</div>
            <div class="sub">${fmtDate(x.date)} · ${explainShare(x, memberId, snap)}</div>
          </div>
          <div class="amt">
            <div class="v">${fmt(share, base)}</div>
            ${paid ? html`<div class="me receive">立替 ${fmt(paid, base)}</div>` : null}
          </div>
        </button>`;
      })}
    </div>` : html`<div class="empty small">まだ関係する記録はありません</div>`}
  </div>`;
}
