import { html, React } from '../lib/html.js';
import { go } from '../lib/router.js';
import { fmt } from '../lib/money.js';
import { updateTrip, saveExpense, deleteExpense } from '../lib/store.js';
import { settlementPlan, settlementText } from '../lib/report.js';
import { Icon } from './icons.js';
import { Avatar, Seg, Sheet, Note, Switch, toast, confirmDialog, copyText, lineShareUrl, fmtDate } from './components.js';
import { newTransfer, TransferFields } from './ExpenseEditor.js';

const { useState, useMemo } = React;

export function Settle({ snap, bal, me }) {
  const trip = snap.trip;
  const base = trip.base || 'JPY';
  const [manual, setManual] = useState(null);
  const [optOpen, setOptOpen] = useState(false);
  const plan = useMemo(() => settlementPlan(snap, bal), [snap, bal]);
  const m = (id) => snap.memberById.get(id);
  const unit = trip.settle?.unit ?? 1;
  const hub = trip.settle?.hub ?? null;
  const done = snap.expenses.filter((x) => x.kind === 'transfer');
  const maxAbs = Math.max(1, ...snap.members.map((x) => Math.abs(bal.members[x.id]?.net ?? 0)));
  const hasExpenses = bal.count > 0;
  const showTotals = !!trip.settle?.showTotals;
  const maxShare = Math.max(1, ...snap.members.map((x) => bal.members[x.id]?.share ?? 0));

  async function markPaid(t) {
    const ok = await confirmDialog({
      title: `${m(t.from)?.name} → ${m(t.to)?.name}`,
      body: `${fmt(t.amount, base)} を送金済みとして記録しますか？（PayPay・現金など、実際のお金のやりとりはアプリの外でしてください）`,
      ok: '記録する',
    });
    if (!ok) return;
    const x = saveExpense(snap.id, newTransfer(t.from, t.to, t.amount, base));
    toast('送金を記録しました', { action: '元に戻す', onAction: () => deleteExpense(snap.id, x.id), duration: 6000 });
  }

  async function share() {
    const text = settlementText(snap, bal);
    if (await copyText(text)) toast('精算のメッセージをコピーしました');
  }

  const unitLabel = unit === 1 ? '1円単位' : `${unit}円単位`;

  return html`<div>
    ${bal.problems.length ? html`<${Note} kind="warn" icon="alert">確認が必要な記録が ${bal.problems.length}件あり、精算に入っていません。「記録」タブの ⚠️ を直してください。<//>` : null}

    <!-- 送金プラン -->
    <div class="hero" style=${{ marginTop: bal.problems.length ? '12px' : 0 }}>
      ${!hasExpenses ? html`<div class="done-banner">
          <div class="big">🧾</div>
          <div class="bold">まだ記録がありません</div>
          <div class="small muted">支払いを記録すると、ここに精算プランが出ます。</div>
        </div>`
      : !plan.transfers.length ? html`<div class="done-banner">
          <div class="big">🎉</div>
          <div class="bold" style=${{ fontSize: '18px' }}>精算はすべて完了！</div>
          <div class="small muted">全員の立て替えと負担がぴったり合っています。</div>
        </div>`
      : html`<div>
          <div class="label">精算プラン</div>
          <div class="row between" style=${{ alignItems: 'baseline' }}>
            <div style=${{ fontFamily: 'var(--font-round)', fontWeight: 700, fontSize: '20px' }}>あと <span class="num" style=${{ fontSize: '28px' }}>${plan.transfers.length}</span> 回の送金で完了</div>
          </div>
          <div class="tiny muted">${hub ? `${m(hub)?.name}さんにまとめる方式` : '送金の回数がいちばん少なくなる組み合わせ'} · ${unitLabel}</div>
        </div>`}
    </div>

    ${plan.transfers.length ? html`<div class="list" style=${{ marginTop: '12px' }}>
      ${plan.transfers.map((t, i) => {
        const mine = me && (t.from === me || t.to === me);
        return html`<div class="transfer" key=${i} style=${mine ? { background: 'var(--sun-soft)' } : null}>
          <div class="names">
            <${Avatar} m=${m(t.from)} /><span>${m(t.from)?.name}</span>
            <span class="arrow"><${Icon} name="arrowRight" size=${16} /></span>
            <${Avatar} m=${m(t.to)} /><span>${m(t.to)?.name}</span>
          </div>
          <div style=${{ textAlign: 'right' }}>
            <div class="v">${fmt(t.amount, base)}</div>
            <button class="btn small" style=${{ marginTop: '4px' }} onClick=${() => markPaid(t)}><${Icon} name="check" size=${16} />払った</button>
          </div>
        </div>`;
      })}
    </div>` : null}

    ${hasExpenses ? html`<div class="row" style=${{ marginTop: '12px' }}>
      <a class="btn sun grow" style=${{ whiteSpace: 'nowrap' }} href=${lineShareUrl(settlementText(snap, bal))} target="_blank" rel="noopener"><${Icon} name="chat" />LINEで送る</a>
      <button class="btn" style=${{ whiteSpace: 'nowrap', padding: '0 14px' }} onClick=${share}><${Icon} name="copy" />コピー</button>
      <button class="btn" style=${{ padding: '0 12px' }} aria-label="精算のしかた（端数・まとめ方）" onClick=${() => setOptOpen(true)}><${Icon} name="settings" /></button>
    </div>` : null}
    ${Object.keys(plan.adjust).length ? html`<div class="tiny faint" style=${{ marginTop: '8px' }}>
      ${unit}円単位にまとめたため、${Object.entries(plan.adjust).map(([id, d]) => `${m(id)?.name} ${d > 0 ? '+' : '−'}${Math.abs(d)}円`).join('、')} の端数調整が入っています。
    </div>` : null}

    <!-- 旅の合計と一人ずつの利用額（見たいときだけ） -->
    ${hasExpenses ? html`<div class="card totals">
      <${Switch} on=${showTotals} label="旅の合計と一人ずつの利用額を表示"
        onChange=${(v) => updateTrip(snap.id, { settle: { ...(trip.settle ?? {}), showTotals: v } })}
        sub="オンにすると、LINEで送る文面にも入ります（メンバー全員に共通の設定）">旅の合計と一人ずつの利用額<//>
      ${showTotals ? html`<div style=${{ marginTop: '12px' }}>
        <div class="grand">
          <div><div class="bold">この旅の合計</div><div class="tiny muted">${bal.count}件 · 平均 ${fmt(Math.round(bal.spent / (snap.members.length || 1)), base)}/人</div></div>
          <span class="v">${fmt(bal.spent, base)}</span>
        </div>
        ${snap.members.map((mm) => {
          const b = bal.members[mm.id] ?? { paid: 0, share: 0 };
          const pct = bal.spent ? Math.round((100 * b.share) / bal.spent) : 0;
          return html`<button class="use-row" key=${mm.id} style=${{ width: '100%', background: 'none', border: 0, textAlign: 'left' }}
            onClick=${() => go(`/t/${snap.id}/m/${mm.id}`)} aria-label=${`${mm.name}の利用額 ${fmt(b.share, base)}`}>
            <${Avatar} m=${mm} />
            <div style=${{ minWidth: 0 }}>
              <div class="bold ellipsis">${mm.name}${mm.id === me ? html`<span class="tiny muted">（あなた）</span>` : null}</div>
              <div class="bar" aria-hidden="true"><i style=${{ width: `${(100 * b.share) / maxShare}%` }}></i></div>
            </div>
            <div style=${{ textAlign: 'right' }}>
              <div class="v">${fmt(b.share, base)}</div>
              <div class="tiny muted">${pct}% · 立替 ${fmt(b.paid, base)}</div>
            </div>
          </button>`;
        })}
        <div class="tiny faint" style=${{ marginTop: '8px' }}>利用額＝その人が使った分（負担額）。名前をタップすると1件ずつの内訳が見られます。</div>
      </div>` : null}
    </div>` : null}

    <!-- ひとりずつ -->
    <h2 class="section">ひとりずつ <span class="aside">立て替えた額 − 使った額</span></h2>
    <div class="list">
      ${snap.members.map((mm) => {
        const b = bal.members[mm.id] ?? { paid: 0, share: 0, net: 0 };
        const w = (Math.abs(b.net) / maxAbs) * 50;
        return html`<button class="bal-row" key=${mm.id} onClick=${() => go(`/t/${snap.id}/m/${mm.id}`)}>
          <div class="row">
            <${Avatar} m=${mm} />
            <div class="grow" style=${{ minWidth: 0 }}>
              <div class="bold">${mm.name}${mm.id === me ? html`<span class="tiny muted">（あなた）</span>` : null}</div>
              <div class="tiny muted">立替 ${fmt(b.paid, base)} · 使った ${fmt(b.share, base)}${b.transferOut ? ` · 送金した ${fmt(b.transferOut, base)}` : ''}${b.transferIn ? ` · 受け取った ${fmt(b.transferIn, base)}` : ''}</div>
            </div>
            <div style=${{ textAlign: 'right' }}>
              <div class=${'num bold ' + (b.net > 0 ? 'receive' : b.net < 0 ? 'pay' : 'faint')} style=${{ fontSize: '17px' }}>${b.net ? fmt(b.net, base, { sign: true }) : '±0'}</div>
              <div class="tiny muted">${b.net > 0 ? '受け取る' : b.net < 0 ? '払う' : '精算済み'}</div>
            </div>
          </div>
          <div class="diverge" aria-hidden="true">
            ${b.net > 0 ? html`<i class="r" style=${{ width: `${w}%` }}></i>` : b.net < 0 ? html`<i class="p" style=${{ width: `${w}%` }}></i>` : null}
          </div>
        </button>`;
      })}
    </div>

    <!-- 送金の記録 -->
    <h2 class="section">送金の記録
      <button class="link-btn" onClick=${() => setManual(newTransfer(me ?? snap.members[0]?.id, snap.members.find((x) => x.id !== (me ?? snap.members[0]?.id))?.id, null, base))}>＋ 手で記録</button>
    </h2>
    ${done.length ? html`<div class="list">
      ${done.map((t) => html`<button class="exp transfer" key=${t.id} onClick=${() => go(`/t/${snap.id}/e/${t.id}`)}>
        <div class="cat"><${Icon} name="check" size=${20} /></div>
        <div class="grow" style=${{ minWidth: 0 }}>
          <div class="t ellipsis">${m(t.from)?.name} → ${m(t.to)?.name}</div>
          <div class="sub">${fmtDate(t.date)}</div>
        </div>
        <div class="amt"><div class="v">${fmt(t.amount, base)}</div></div>
      </button>`)}
    </div>` : html`<div class="small faint" style=${{ padding: '0 6px' }}>「払った」を押すと、ここに残ります。途中で一部だけ払ったときは「手で記録」から。</div>`}

    <${Sheet} open=${optOpen} onClose=${() => setOptOpen(false)} title="精算のしかた">
      <div class="stack">
        <div class="field"><span class="label">端数</span>
          <${Seg} label="端数" value=${unit} onChange=${(v) => updateTrip(snap.id, { settle: { ...(trip.settle ?? {}), unit: v } })}
            options=${[{ value: 1, label: '1円単位' }, { value: 10, label: '10円単位' }, { value: 100, label: '100円単位' }]} />
        </div>
        <div class="field"><span class="label">送金のしかた</span>
          <${Seg} label="送金のしかた" value=${hub ? 'hub' : 'min'}
            onChange=${(v) => updateTrip(snap.id, { settle: { ...(trip.settle ?? {}), hub: v === 'hub' ? (me ?? snap.members[0]?.id) : null } })}
            options=${[{ value: 'min', label: '回数を最少に' }, { value: 'hub', label: '1人にまとめる' }]} />
          ${hub ? html`<div class="chips" style=${{ marginTop: '8px' }}>
            ${snap.members.map((mm) => html`<button key=${mm.id} class=${'chip' + (hub === mm.id ? ' on' : '')} aria-pressed=${hub === mm.id}
              onClick=${() => updateTrip(snap.id, { settle: { ...(trip.settle ?? {}), hub: mm.id } })}><${Avatar} m=${mm} />${mm.name}</button>`)}
          </div>` : null}
          <div class="tiny muted" style=${{ marginTop: '6px' }}>${hub ? 'みんなが幹事に払い、幹事が受け取る人に払います。お金の流れが単純になります。' : '「誰が誰にいくら」の組み合わせを計算して、送金の回数を最少にします。'}</div>
        </div>
        <div class="tiny faint">この設定は旅のメンバー全員に共有されます。</div>
      </div>
    <//>

    <${Sheet} open=${!!manual} onClose=${() => setManual(null)} title="送金を記録">
      ${manual ? html`<div class="stack">
        <${TransferFields} snap=${snap} t=${manual} setT=${setManual} />
        <button class="btn primary block" disabled=${!(manual.from && manual.to && manual.from !== manual.to && manual.amount > 0)}
          onClick=${() => { saveExpense(snap.id, manual); setManual(null); toast('送金を記録しました'); }}>記録する</button>
      </div>` : null}
    <//>
  </div>`;
}
