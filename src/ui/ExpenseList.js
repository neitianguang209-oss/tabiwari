import { html, React } from '../lib/html.js';
import { go } from '../lib/router.js';
import { fmt } from '../lib/money.js';
import { Icon } from './icons.js';
import { Avatar, Note, catOf, fmtDate, dayIndex } from './components.js';

const { useState, useMemo } = React;

const MODE_LABEL = { equal: '均等', items: '内訳', exact: '一人ずつ' };

export function ExpenseRow({ x, snap, bal, me, highlight }) {
  const trip = snap.trip;
  const base = trip.base || 'JPY';
  const r = bal.perExpense.get(x.id);
  const name = (id) => snap.memberById.get(id)?.name ?? '?';
  const open = () => go(`/t/${snap.id}/e/${x.id}`);

  if (x.kind === 'transfer') {
    const from = snap.memberById.get(x.from), to = snap.memberById.get(x.to);
    return html`<button class="exp transfer" onClick=${open}>
      <div class="cat"><${Icon} name="settle" size=${20} /></div>
      <div class="grow" style=${{ minWidth: 0 }}>
        <div class="t ellipsis">${name(x.from)} → ${name(x.to)}</div>
        <div class="sub"><${Avatar} m=${from} size="xs" /><${Icon} name="arrowRight" size=${12} /><${Avatar} m=${to} size="xs" /> 精算の送金</div>
      </div>
      <div class="amt"><div class="v">${fmt(x.amount, base)}</div></div>
    </button>`;
  }

  const cur = x.currency || base;
  const paidIds = Object.keys(r?.paid ?? {});
  const payers = paidIds.length ? paidIds : x.payers ? Object.keys(x.payers) : x.paidBy ? [x.paidBy] : [];
  const nShare = Object.keys(r?.shares ?? {}).length;
  const mine = me && r && !r.problem ? r.shares[me] ?? 0 : null;
  const cat = catOf(x.category);
  return html`<button class=${'exp' + (r?.problem ? ' problem' : '')} onClick=${open} style=${highlight ? { background: 'var(--sun-soft)' } : null}>
    <div class="cat" aria-hidden="true">${r?.problem ? '⚠️' : cat.emoji}</div>
    <div class="grow" style=${{ minWidth: 0 }}>
      <div class="t ellipsis">${x.title || cat.label}</div>
      <div class="sub">
        ${payers.slice(0, 2).map((id) => html`<${Avatar} key=${id} m=${snap.memberById.get(id)} size="xs" />`)}
        <span>${payers.length > 1 ? `${payers.length}人で立替` : `${name(payers[0])}が立替`}</span>
        <span aria-hidden="true">·</span>
        <span>${nShare}人</span>
        ${x.split?.mode && x.split.mode !== 'equal' ? html`<span class="badge">${MODE_LABEL[x.split.mode]}</span>` : null}
        ${x.split?.weights ? html`<span class="badge">比率</span>` : null}
        ${x.source === 'ai' ? html`<span class="badge sun">AI</span>` : null}
        ${r?.problem ? html`<span class="badge warn">要確認</span>` : null}
      </div>
    </div>
    <div class="amt">
      <div class="v">${fmt(x.amount, cur)}</div>
      ${cur !== base && r && !r.problem ? html`<div class="me">≈ ${fmt(r.total, base)}</div>` : null}
      ${mine != null ? html`<div class="me">あなた ${fmt(mine, base)}</div>` : null}
    </div>
  </button>`;
}

export function ExpenseList({ snap, bal, me }) {
  const trip = snap.trip;
  const base = trip.base || 'JPY';
  const [filter, setFilter] = useState(null);
  const meM = me ? snap.memberById.get(me) : null;
  const net = me ? bal.members[me]?.net ?? 0 : null;

  const groups = useMemo(() => {
    const list = snap.expenses.filter((x) => {
      if (!filter) return true;
      const r = bal.perExpense.get(x.id);
      if (x.kind === 'transfer') return x.from === filter || x.to === filter;
      return (r?.paid?.[filter] || r?.shares?.[filter]) || x.paidBy === filter;
    });
    const map = new Map();
    for (const x of list) {
      const d = x.date || '';
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(x);
    }
    return [...map.entries()];
  }, [snap, bal, filter]);

  if (!snap.expenses.length) {
    return html`<div>
      <${Hero} snap=${snap} bal=${bal} me=${me} net=${net} meM=${meM} />
      <div class="empty">
        <div class="e">🧾</div>
        <div class="bold" style=${{ color: 'var(--ink)' }}>まだ記録がありません</div>
        <div class="small" style=${{ marginTop: '6px', lineHeight: 1.8 }}>
          だれかが払ったら「＋記録」から入れよう。<br />レシートはカメラのボタンで撮るだけ。
        </div>
      </div>
    </div>`;
  }

  return html`<div>
    <${Hero} snap=${snap} bal=${bal} me=${me} net=${net} meM=${meM} />

    ${bal.problems.length ? html`<div style=${{ marginTop: '12px' }}><${Note} kind="warn" icon="alert">
      確認が必要な記録が ${bal.problems.length}件あります（集計に入っていません）。<span class="bold">⚠️</span> の行を開いて直してください。
    <//></div>` : null}

    ${snap.members.length > 1 ? html`<div class="chips" style=${{ marginTop: '16px' }} role="group" aria-label="人で絞り込む">
      <button class=${'chip plain' + (!filter ? ' on' : '')} onClick=${() => setFilter(null)}>すべて</button>
      ${snap.members.map((m) => html`<button key=${m.id} class=${'chip' + (filter === m.id ? ' on' : '')} aria-pressed=${filter === m.id}
        onClick=${() => setFilter(filter === m.id ? null : m.id)}><${Avatar} m=${m} size="sm" />${m.name}</button>`)}
    </div>` : null}

    ${groups.map(([d, list]) => {
      const dayTotal = list.filter((x) => x.kind !== 'transfer').reduce((a, x) => a + (bal.perExpense.get(x.id)?.problem ? 0 : bal.perExpense.get(x.id)?.total ?? 0), 0);
      const di = dayIndex(trip, d);
      return html`<section key=${d}>
        <div class="day-head">
          <span class="d">${fmtDate(d)}${di ? html` <span class="muted small">${di}日目</span>` : null}</span>
          <span class="t num">${dayTotal ? fmt(dayTotal, base) : ''}</span>
        </div>
        <div class="list">${list.map((x) => html`<${ExpenseRow} key=${x.id} x=${x} snap=${snap} bal=${bal} me=${me} />`)}</div>
      </section>`;
    })}
    ${!groups.length ? html`<div class="empty small">この人に関係する記録はありません</div>` : null}
  </div>`;
}

function Hero({ snap, bal, me, net, meM }) {
  const base = snap.trip.base || 'JPY';
  const nPeople = snap.members.length || 1;
  return html`<div class="hero">
    <div class="row between">
      <div>
        <div class="label">みんなで使った合計</div>
        <div class="big">${fmt(bal.spent, base)}</div>
        <div class="tiny muted" style=${{ marginTop: '4px' }}>${bal.count}件 · ${nPeople}人${nPeople > 1 ? ` · 平均 ${fmt(Math.round(bal.spent / nPeople), base)}/人` : ''}</div>
      </div>
    </div>
    ${meM ? html`<div class="hero-split">
      <div class="me-box">
        <div class="label">${meM.name}が立て替えた</div>
        <div class="v num">${fmt(bal.members[me]?.paid ?? 0, base)}</div>
      </div>
      <button class=${'me-box ' + (net > 0 ? 'receive' : net < 0 ? 'pay' : '')} style=${{ border: 0, textAlign: 'left' }} onClick=${() => go(`/t/${snap.id}/settle`)}>
        <div class="label">${net > 0 ? '精算で受け取る' : net < 0 ? '精算で払う' : '精算'}</div>
        <div class=${'v num ' + (net > 0 ? 'receive' : net < 0 ? 'pay' : '')}>${net ? fmt(Math.abs(net), base) : '±0'}</div>
        <div class="tiny muted">精算を見る ›</div>
      </button>
    </div>` : null}
  </div>`;
}
