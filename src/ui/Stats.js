import { html, React } from '../lib/html.js';
import { go } from '../lib/router.js';
import { fmt } from '../lib/money.js';
import { Avatar, CATEGORIES, fmtDate, dayIndex } from './components.js';

const { useMemo } = React;

// まとめ：棒グラフは1色（量をくらべるだけ・名前はラベルで示す）
export function Stats({ snap, bal, me }) {
  const trip = snap.trip;
  const base = trip.base || 'JPY';

  const data = useMemo(() => {
    const byCat = new Map(CATEGORIES.map((c) => [c.id, 0]));
    const byDay = new Map();
    const byCur = new Map();
    for (const x of snap.expenses) {
      if (x.kind === 'transfer') continue;
      const r = bal.perExpense.get(x.id);
      if (!r || r.problem) continue;
      const cat = byCat.has(x.category) ? x.category : 'other';
      byCat.set(cat, byCat.get(cat) + r.total);
      byDay.set(x.date, (byDay.get(x.date) ?? 0) + r.total);
      const c = x.currency || base;
      byCur.set(c, (byCur.get(c) ?? 0) + 1);
    }
    const cats = CATEGORIES.map((c) => ({ ...c, v: byCat.get(c.id) })).filter((c) => c.v > 0).sort((a, b) => b.v - a.v);
    const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return { cats, days };
  }, [snap, bal]);

  if (!bal.count) {
    return html`<div class="empty"><div class="e">📊</div><div class="bold" style=${{ color: 'var(--ink)' }}>まだ記録がありません</div><div class="small">記録がたまると、ここに旅のまとめが出ます。</div></div>`;
  }

  const n = snap.members.length || 1;
  const maxShare = Math.max(1, ...snap.members.map((m) => bal.members[m.id]?.share ?? 0));
  const maxCat = Math.max(1, ...data.cats.map((c) => c.v));
  const maxDay = Math.max(1, ...data.days.map((d) => d[1]));
  const nDays = data.days.length;

  return html`<div>
    <div class="stat-grid">
      <div class="stat"><div class="l">総額</div><div class="v num">${fmt(bal.spent, base)}</div></div>
      <div class="stat"><div class="l">平均 / 人</div><div class="v num">${fmt(Math.round(bal.spent / n), base)}</div></div>
      <div class="stat"><div class="l">${nDays > 1 ? '平均 / 日' : '記録'}</div><div class="v num">${nDays > 1 ? fmt(Math.round(bal.spent / nDays), base) : `${bal.count}件`}</div></div>
    </div>

    <h2 class="section">ひとりずつ使った額 <span class="aside">タップで内訳</span></h2>
    <div class="card" role="list">
      ${snap.members.map((m) => {
        const v = bal.members[m.id]?.share ?? 0;
        return html`<button key=${m.id} role="listitem" class="hbar" style=${{ width: '100%', background: 'none', border: 0, textAlign: 'left', padding: '7px 0' }}
          onClick=${() => go(`/t/${snap.id}/m/${m.id}`)} title=${`${m.name}: ${fmt(v, base)}`}>
          <span class="row" style=${{ gap: '6px', minWidth: 0 }}><${Avatar} m=${m} size="sm" /><span class="small bold ellipsis">${m.name}</span></span>
          <span class="track"><i style=${{ width: `${(100 * v) / maxShare}%` }}></i></span>
          <span class="v">${fmt(v, base)}</span>
        </button>`;
      })}
    </div>

    <h2 class="section">種類別</h2>
    <div class="card">
      ${data.cats.map((c) => html`<div class="hbar" key=${c.id} title=${`${c.label}: ${fmt(c.v, base)}`}>
        <span class="small bold ellipsis">${c.emoji} ${c.label}<span class="pct">${Math.round((100 * c.v) / (bal.spent || 1))}%</span></span>
        <span class="track"><i style=${{ width: `${(100 * c.v) / maxCat}%` }}></i></span>
        <span class="v">${fmt(c.v, base)}</span>
      </div>`)}
    </div>

    ${nDays > 1 ? html`<h2 class="section">日ごと</h2>
    <div class="card">
      <div class="vbars" role="list">
        ${data.days.map(([d, v]) => {
          const di = dayIndex(trip, d);
          return html`<div class="col" key=${d} role="listitem" title=${`${fmtDate(d)}: ${fmt(v, base)}`}>
            <span class="val">${v >= 10000 ? (v / 10000).toFixed(1).replace(/\.0$/, '') + '万' : v.toLocaleString()}</span>
            <i style=${{ height: `${Math.max(2, (100 * v) / maxDay)}%` }}></i>
          </div>`;
        })}
      </div>
      <div class="vbars-axis"></div>
      <div class="row" style=${{ gap: '6px' }}>
        ${data.days.map(([d]) => {
          const di = dayIndex(trip, d);
          return html`<div key=${d} style=${{ flex: 1, textAlign: 'center', minWidth: 0 }} class="tiny muted ellipsis">${di ? `${di}日目` : fmtDate(d, { weekday: false })}</div>`;
        })}
      </div>
    </div>` : null}

    <h2 class="section">記録の内訳</h2>
    <div class="card small muted" style=${{ lineHeight: 1.9 }}>
      <div class="row between"><span>支払いの記録</span><span class="num">${bal.count}件</span></div>
      <div class="row between"><span>そのうちレシートAIで読んだもの</span><span class="num">${snap.expenses.filter((x) => x.source === 'ai').length}件</span></div>
      <div class="row between"><span>精算の送金</span><span class="num">${snap.expenses.filter((x) => x.kind === 'transfer').length}件</span></div>
    </div>
  </div>`;
}
