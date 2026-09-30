import { html, React } from '../lib/html.js';
import { go } from '../lib/router.js';
import { updateTrip, saveMember, setMe, exportTrip, forgetTrip, pendingCount } from '../lib/store.js';
import { curInfo, fmtRate } from '../lib/money.js';
import { toCsv, downloadFile } from '../lib/report.js';
import { APP_VERSION } from '../config.js';
import { Icon } from './icons.js';
import { Avatar, Sheet, Note, MEMBER_COLORS, toast, confirmDialog, fmtDate } from './components.js';
import { TRIP_EMOJIS, CurrencySheet, addCurrencyWithRate } from './CreateTrip.js';
import { WhoAmISheet } from './TripPage.js';
import { AiSetupSheet } from './AiSetup.js';
import { aiStatus } from './receipt.js';

const { useState, useEffect } = React;

function involved(snap, bal, id) {
  const b = bal.members[id];
  if (b && (b.paid || b.share || b.transferIn || b.transferOut)) return true;
  return snap.expenses.some((x) => x.paidBy === id || x.from === id || x.to === id || (x.split?.members ?? []).includes(id) || (x.payers && x.payers[id]));
}

export function Settings({ snap, bal, me, onShare }) {
  const trip = snap.trip;
  const [tripOpen, setTripOpen] = useState(false);
  const [editM, setEditM] = useState(null);
  const [curOpen, setCurOpen] = useState(false);
  const [rateEdit, setRateEdit] = useState(null);
  const [whoOpen, setWhoOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [ai, setAi] = useState(undefined);
  const meM = me ? snap.memberById.get(me) : null;

  useEffect(() => { aiStatus().then(setAi); }, []);

  async function addCur(c) {
    const r = await addCurrencyWithRate(c, trip.base || 'JPY');
    updateTrip(snap.id, { currencies: [...(trip.currencies ?? []), c], rates: { ...(trip.rates ?? {}), ...(r.rate ? { [c]: r } : {}) } });
    toast(r.rate ? `${curInfo(c).name}を追加しました（${fmtRate(c, trip.base || 'JPY', r.rate)}）` : `${curInfo(c).name}を追加しました。レートを入れてください`);
    if (!r.rate) setRateEdit({ cur: c, value: '' });
  }
  async function refreshRate(c) {
    const r = await addCurrencyWithRate(c, trip.base || 'JPY');
    if (!r.rate) { toast('レートを取得できませんでした'); return; }
    updateTrip(snap.id, { rates: { ...(trip.rates ?? {}), [c]: r } });
    toast(`最新のレートにしました（${fmtRate(c, trip.base || 'JPY', r.rate)}）`);
  }
  function removeCur(c) {
    if (snap.expenses.some((x) => x.currency === c)) { toast(`${curInfo(c).name}の記録があるので外せません`); return; }
    const rates = { ...(trip.rates ?? {}) };
    delete rates[c];
    updateTrip(snap.id, { currencies: (trip.currencies ?? []).filter((x) => x !== c), rates });
  }

  function backupJson() {
    const data = exportTrip(snap.id);
    downloadFile(`たびわり_${trip.name}_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
  }
  function backupCsv() {
    downloadFile(`たびわり_${trip.name}.csv`, toCsv(snap, bal), 'text/csv;charset=utf-8');
  }
  async function forget() {
    const p = pendingCount(snap.id);
    const ok = await confirmDialog({
      title: 'この端末の一覧から外しますか？',
      body: p ? `まだ送信できていない変更が${p}件あります。電波のあるところで送信が終わってから外すのがおすすめです。` : 'クラウドの記録は消えません。リンクを開けばまた見られます。',
      ok: '外す',
      danger: true,
    });
    if (!ok) return;
    await forgetTrip(snap.id);
    go('/', { replace: true });
  }

  return html`<div>
    <h2 class="section" style=${{ marginTop: '6px' }}>旅</h2>
    <div class="list">
      <button class="list-item" onClick=${() => setTripOpen(true)}>
        <div class="trip-emoji" style=${{ width: '42px', height: '42px', fontSize: '22px', borderRadius: '12px' }}>${trip.emoji || '🧳'}</div>
        <div class="grow"><div class="bold">${trip.name}</div>
          <div class="tiny muted">${trip.start ? `${fmtDate(trip.start, { year: true })}〜${fmtDate(trip.end || trip.start)}` : '日程なし'}</div></div>
        <${Icon} name="chevronRight" />
      </button>
      <button class="list-item" onClick=${onShare}>
        <${Icon} name="share" /><span class="grow bold">メンバーを招待（リンク・QR）</span><${Icon} name="chevronRight" />
      </button>
    </div>

    <h2 class="section">メンバー <span class="aside">${snap.members.length}人</span></h2>
    <div class="list">
      ${snap.members.map((m) => html`<button class="list-item" key=${m.id} onClick=${() => setEditM({ ...m })}>
        <${Avatar} m=${m} />
        <div class="grow"><div class="bold">${m.name}${m.id === me ? html` <span class="badge sun">あなた</span>` : null}</div>
          ${m.from || m.to ? html`<div class="tiny muted">${m.from ? fmtDate(m.from) : ''}〜${m.to ? fmtDate(m.to) : ''} だけ参加</div>` : null}</div>
        <${Icon} name="edit" size=${18} />
      </button>`)}
      <button class="list-item" onClick=${() => setEditM({ name: '', color: snap.allMembers.length % 8 })}>
        <${Icon} name="plus" /><span class="grow bold">メンバーを追加</span>
      </button>
    </div>

    <h2 class="section">通貨とレート <span class="aside">精算は${curInfo(trip.base || 'JPY').name}</span></h2>
    <div class="list">
      ${(trip.currencies ?? []).map((c) => html`<div class="list-item" key=${c}>
        <span style=${{ fontSize: '22px' }}>${curInfo(c).flag}</span>
        <div class="grow"><div class="bold">${curInfo(c).name}</div>
          <div class="tiny muted">${fmtRate(c, trip.base || 'JPY', trip.rates?.[c]?.rate)}${trip.rates?.[c]?.source === 'manual' ? '（手入力）' : trip.rates?.[c]?.date ? `（${trip.rates[c].date}時点）` : ''}</div></div>
        <button class="icon-btn" aria-label="最新のレートにする" onClick=${() => refreshRate(c)}><${Icon} name="refresh" size=${18} /></button>
        <button class="icon-btn" aria-label="レートを手で入れる" onClick=${() => setRateEdit({ cur: c, value: String(trip.rates?.[c]?.rate ?? '') })}><${Icon} name="edit" size=${18} /></button>
        <button class="icon-btn" aria-label="外す" onClick=${() => removeCur(c)}><${Icon} name="close" size=${18} /></button>
      </div>`)}
      <button class="list-item" onClick=${() => setCurOpen(true)}><${Icon} name="globe" /><span class="grow bold">通貨を追加（海外旅行）</span></button>
    </div>
    ${(trip.currencies ?? []).length ? html`<div class="tiny faint" style=${{ padding: '8px 6px 0' }}>両替した実際のレートに合わせたいときは ✏️ から。カード払いは記録ごとに「カードの円額」を入れると正確になります。</div>` : null}

    <h2 class="section">この端末</h2>
    <div class="list">
      <button class="list-item" onClick=${() => setWhoOpen(true)}>
        ${meM ? html`<${Avatar} m=${meM} />` : html`<${Icon} name="eye" />`}
        <div class="grow"><div class="bold">${meM ? `「${meM.name}」として使っています` : '見るだけ（あなたが未選択）'}</div>
          <div class="tiny muted">タップで変更</div></div>
        <${Icon} name="chevronRight" />
      </button>
      <button class="list-item" onClick=${() => setAiOpen(true)}>
        <${Icon} name="sparkle" />
        <div class="grow"><div class="bold">レシートのAI読み取り</div>
          <div class="tiny muted">${ai === undefined ? '確認中…' : ai === null ? 'オフラインのため確認できません' : ai ? '使えます（メンバー全員）' : 'まだ準備されていません — タップして準備'}</div></div>
        ${ai ? html`<span class="badge sun">ON</span>` : html`<${Icon} name="chevronRight" />`}
      </button>
    </div>

    <h2 class="section">データ</h2>
    <div class="list">
      <button class="list-item" onClick=${backupCsv}><${Icon} name="download" /><div class="grow"><div class="bold">CSVで保存</div><div class="tiny muted">Excel・スプレッドシートで開けます</div></div></button>
      <button class="list-item" onClick=${backupJson}><${Icon} name="download" /><div class="grow"><div class="bold">バックアップを保存（JSON）</div><div class="tiny muted">ホームの「バックアップから戻す」で復元できます</div></div></button>
      <button class="list-item" onClick=${forget}><${Icon} name="trash" /><div class="grow"><div class="bold pay">この端末の一覧から外す</div><div class="tiny muted">クラウドの記録は消えません</div></div></button>
    </div>

    <p class="tiny faint" style=${{ textAlign: 'center', marginTop: '24px', lineHeight: 1.7 }}>
      たびわり v${APP_VERSION}<br />記録はこの端末とクラウドの両方に保存されます。電波がないときは端末に保存し、つながったら自動で送ります。
    </p>

    <${TripSheet} open=${tripOpen} onClose=${() => setTripOpen(false)} trip=${trip} tripId=${snap.id} />
    <${MemberSheet} m=${editM} onClose=${() => setEditM(null)} snap=${snap} bal=${bal} me=${me} />
    <${CurrencySheet} open=${curOpen} onClose=${() => setCurOpen(false)} exclude=${[trip.base || 'JPY', ...(trip.currencies ?? [])]} onPick=${addCur} />
    <${Sheet} open=${!!rateEdit} onClose=${() => setRateEdit(null)} title=${rateEdit ? `${curInfo(rateEdit.cur).name}のレート` : ''}>
      ${rateEdit ? html`<div class="stack">
        <div class="field"><label for="rate">1${curInfo(rateEdit.cur).sym.trim()} は何円？</label>
          <input id="rate" class="input num-input" inputmode="decimal" value=${rateEdit.value} placeholder="例）0.108"
            onInput=${(e) => setRateEdit({ ...rateEdit, value: e.target.value })} />
        </div>
        <div class="tiny muted">例：1万ウォンを1,080円で両替したなら 1080 ÷ 10000 ＝ 0.108</div>
        <button class="btn primary block" disabled=${!(parseFloat(String(rateEdit.value).normalize('NFKC')) > 0)} onClick=${() => {
          const v = parseFloat(String(rateEdit.value).normalize('NFKC'));
          updateTrip(snap.id, { rates: { ...(trip.rates ?? {}), [rateEdit.cur]: { rate: v, source: 'manual', at: new Date().toISOString() } } });
          setRateEdit(null);
          toast('レートを保存しました');
        }}>保存</button>
      </div>` : null}
    <//>
    <${WhoAmISheet} open=${whoOpen} snap=${snap} title="この端末では、あなたはどの人？"
      onPick=${(id) => { setMe(snap.id, id); setWhoOpen(false); }}
      onSkip=${() => { setMe(snap.id, null); setWhoOpen(false); }} />
    <${AiSetupSheet} open=${aiOpen} tripId=${snap.id} onClose=${() => setAiOpen(false)} onReady=${() => { setAi(true); setAiOpen(false); }} />
  </div>`;
}

function TripSheet({ open, onClose, trip, tripId }) {
  const [t, setT] = useState(trip);
  useEffect(() => { if (open) setT(trip); }, [open]);
  return html`<${Sheet} open=${open} onClose=${onClose} title="旅の情報">
    <div class="stack">
      <div class="field"><label for="tn">旅の名前</label>
        <input id="tn" class="input" value=${t.name} onInput=${(e) => setT({ ...t, name: e.target.value })} /></div>
      <div class="emoji-grid">
        ${TRIP_EMOJIS.map((em) => html`<button type="button" key=${em} class=${em === t.emoji ? 'on' : ''} aria-pressed=${em === t.emoji} onClick=${() => setT({ ...t, emoji: em })}>${em}</button>`)}
      </div>
      <div class="row">
        <div class="field grow"><label for="ts">行く日</label><input id="ts" type="date" class="input" value=${t.start ?? ''} onInput=${(e) => setT({ ...t, start: e.target.value || null })} /></div>
        <div class="field grow"><label for="te">帰る日</label><input id="te" type="date" class="input" value=${t.end ?? ''} onInput=${(e) => setT({ ...t, end: e.target.value || null })} /></div>
      </div>
      <button class="btn primary block" disabled=${!t.name?.trim()} onClick=${() => {
        updateTrip(tripId, { name: t.name.trim(), emoji: t.emoji, start: t.start || null, end: t.end || t.start || null });
        onClose();
        toast('保存しました');
      }}>保存</button>
    </div>
  <//>`;
}

function MemberSheet({ m, onClose, snap, bal, me }) {
  const [v, setV] = useState(m);
  useEffect(() => { setV(m); }, [m]);
  if (!m || !v) return null;
  const isNew = !m.id;
  const inv = !isNew && involved(snap, bal, m.id);
  const dupe = snap.members.some((x) => x.id !== m.id && x.name.trim() === (v.name ?? '').trim());
  function save() {
    const saved = saveMember(snap.id, { ...v, name: v.name.trim(), from: v.from || null, to: v.to || null });
    toast(isNew ? `${saved.name}を追加しました` : '保存しました');
    onClose();
  }
  async function remove() {
    if (inv) return;
    if (!(await confirmDialog({ title: `${m.name}をメンバーから外しますか？`, ok: '外す', danger: true }))) return;
    saveMember(snap.id, { ...m, removed: true });
    if (me === m.id) setMe(snap.id, null);
    onClose();
  }
  return html`<${Sheet} open=${!!m} onClose=${onClose} title=${isNew ? 'メンバーを追加' : 'メンバーを編集'}>
    <div class="stack">
      <div class="row">
        <${Avatar} m=${{ ...v, name: v.name || '?' }} size="lg" />
        <input class="input grow" placeholder="名前" value=${v.name} aria-label="名前" onInput=${(e) => setV({ ...v, name: e.target.value })} />
      </div>
      ${dupe ? html`<div class="small pay">同じ名前の人がいます</div>` : null}
      <div class="field"><span class="label">色</span>
        <div class="row" style=${{ gap: '8px', flexWrap: 'wrap' }}>
          ${MEMBER_COLORS.map((c, i) => html`<button key=${c} aria-label=${'色' + (i + 1)} aria-pressed=${v.color === i} onClick=${() => setV({ ...v, color: i })}
            style=${{ width: '34px', height: '34px', borderRadius: '50%', background: c, border: v.color === i ? '3px solid var(--ink)' : '3px solid transparent', boxShadow: '0 0 0 2px var(--surface) inset' }}></button>`)}
        </div>
      </div>
      <div class="field"><span class="label">途中参加・途中帰り（任意）</span>
        <div class="row">
          <input type="date" class="input grow" aria-label="参加する日" value=${v.from ?? ''} onInput=${(e) => setV({ ...v, from: e.target.value || null })} />
          <span class="muted">〜</span>
          <input type="date" class="input grow" aria-label="帰る日" value=${v.to ?? ''} onInput=${(e) => setV({ ...v, to: e.target.value || null })} />
        </div>
        <div class="tiny muted">入れておくと、その日以外の記録では最初から「割る人」から外れます。</div>
      </div>
      <button class="btn primary block" disabled=${!(v.name ?? '').trim() || dupe} onClick=${save}>${isNew ? '追加' : '保存'}</button>
      ${!isNew ? (inv
        ? html`<div class="tiny faint" style=${{ textAlign: 'center' }}>記録に関わっているので外せません（名前の変更はできます）</div>`
        : html`<button class="btn ghost danger block" onClick=${remove}>メンバーから外す</button>`) : null}
    </div>
  <//>`;
}
