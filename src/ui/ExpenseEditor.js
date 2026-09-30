import { html, React } from '../lib/html.js';
import { back, go } from '../lib/router.js';
import { openTrip, closeTrip, getExpense, saveExpense, deleteExpense, getPrefs, setPrefs, flushAll } from '../lib/store.js';
import { newExpenseId, newLineId, todayStr } from '../lib/ids.js';
import { fmt, parseAmount, toInputString, decimals, curInfo, fmtRate, convertMinor } from '../lib/money.js';
import { expenseInBase, rateOf } from '../lib/split.js';
import { useTripData } from './hooks.js';
import { Icon } from './icons.js';
import {
  Avatar, Seg, Switch, Stepper, Sheet, Note, CATEGORIES, guessCategory, toast, confirmDialog,
} from './components.js';
import {
  takePendingReceipt, compressImage, readReceipt, AI_ERRORS,
} from './receipt.js';
import { AiSetupSheet } from './AiSetup.js';
import { CalcSheet, CalcButton } from './Calculator.js';

const { useState, useEffect, useMemo, useRef } = React;

const tripCurrencies = (trip) => [trip.base || 'JPY', ...(trip.currencies ?? []).filter((c) => c !== (trip.base || 'JPY'))];
const presentOn = (m, date) => (!m.from || date >= m.from) && (!m.to || date <= m.to);
const clone = (o) => JSON.parse(JSON.stringify(o));

// 金額入力（打っている途中の「12.」なども崩さない）
function AmountField({ value, cur, onChange, placeholder = '0', className = '', big = false, ariaLabel, id }) {
  const [text, setText] = useState(value == null ? '' : toInputString(value, cur));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : toInputString(value, cur));
  }, [value, cur]);
  return html`<input id=${id} class=${big ? '' : 'input compact num-input ' + className} inputmode="decimal" autocomplete="off"
    value=${text} placeholder=${placeholder} aria-label=${ariaLabel}
    onFocus=${(e) => { focused.current = true; if (big) e.target.select(); }}
    onBlur=${() => { focused.current = false; setText(value == null ? '' : toInputString(value, cur)); }}
    onInput=${(e) => { setText(e.target.value); onChange(parseAmount(e.target.value, cur)); }} />`;
}

// 小さい金額欄（左端に電卓ボタン入り）
function CalcAmount({ value, cur, onChange, onCalc, ariaLabel, placeholder = '0' }) {
  return html`<span class="amt-group">
    <${CalcButton} onClick=${onCalc} label=${ariaLabel + 'を電卓で計算'} />
    <${AmountField} value=${value} cur=${cur} ariaLabel=${ariaLabel} placeholder=${placeholder} onChange=${onChange} />
  </span>`;
}

export function ExpenseEditor({ tripId, expenseId, query }) {
  useEffect(() => { openTrip(tripId); return () => closeTrip(tripId); }, [tripId]);
  const { snap, me } = useTripData(tripId);
  const [initial] = useState(() => (expenseId ? getExpense(tripId, expenseId) : null));

  if (!snap?.trip) return html`<div class="page"><div class="empty"><div class="e">⏳</div>読み込んでいます…</div></div>`;
  const existing = initial ?? (expenseId ? getExpense(tripId, expenseId) : null);
  if (expenseId && !existing) {
    return html`<div class="page">
      <div class="topbar"><button class="icon-btn" aria-label="戻る" onClick=${() => back('/t/' + tripId)}><${Icon} name="back" /></button><h1>記録</h1></div>
      <div class="empty"><div class="e">🔍</div>この記録は見つかりませんでした</div>
    </div>`;
  }
  if (existing?.kind === 'transfer') return html`<${TransferEditor} snap=${snap} existing=${existing} />`;
  return html`<${ExpenseForm} snap=${snap} me=${me} existing=${existing} autoReceipt=${query?.receipt === '1'} presetAmount=${query?.amount ?? null} />`;
}

// 新しい記録で最初に選んでおく通貨（前回の通貨。海外の旅の期間中なら外貨）
export function defaultCurrency(snap) {
  const trip = snap.trip;
  const base = trip.base || 'JPY';
  const prefs = getPrefs(snap.id);
  const date = todayStr();
  const curs = tripCurrencies(trip);
  let currency = curs.includes(prefs.lastCurrency) ? prefs.lastCurrency : base;
  if (!prefs.lastCurrency && curs.length > 1 && trip.start && date >= trip.start && (!trip.end || date <= trip.end)) currency = curs[1];
  return currency;
}

function makeDraft(snap, me) {
  const date = todayStr();
  const currency = defaultCurrency(snap);
  return {
    id: newExpenseId(),
    kind: 'expense',
    title: '',
    category: null,
    date,
    currency,
    amount: null,
    paidBy: me && snap.memberById.has(me) ? me : snap.members[0]?.id,
    payers: null,
    baseAmount: null,
    split: {
      mode: 'equal',
      members: snap.members.filter((m) => presentOn(m, date)).map((m) => m.id),
      rest: 'equal',
      lines: [],
      exact: {},
    },
    memo: '',
    source: 'manual',
  };
}

// 保存前の片付け（空の行・0円の人・外れた人の比率を消す）
function normalize(x) {
  const y = clone(x);
  const s = y.split;
  s.members = [...new Set(s.members)];
  if (s.mode === 'items') {
    s.lines = (s.lines ?? []).filter((l) => l.amount || (l.name ?? '').trim());
  } else if (s.mode === 'exact') {
    s.exact = Object.fromEntries(Object.entries(s.exact ?? {}).filter(([, v]) => v));
  }
  if (s.mode !== 'items') delete s.lines;
  if (s.mode !== 'exact') delete s.exact;
  if (s.weights) s.weights = Object.fromEntries(s.members.map((id) => [id, s.weights[id] ?? 1]));
  if (y.payers) {
    y.payers = Object.fromEntries(Object.entries(y.payers).filter(([, v]) => v));
    const ids = Object.keys(y.payers);
    if (ids.length === 1) { y.paidBy = ids[0]; y.payers = null; }
    else if (ids.length > 1) y.paidBy = ids[0];
  }
  if (!y.payers) delete y.payers;
  if (!(y.baseAmount > 0) || y.currency === undefined) y.baseAmount = null;
  y.title = (y.title ?? '').trim();
  y.memo = (y.memo ?? '').trim();
  return y;
}

function ExpenseForm({ snap, me, existing, autoReceipt, presetAmount }) {
  const trip = snap.trip;
  const tripId = snap.id;
  const base = trip.base || 'JPY';
  const currencies = tripCurrencies(trip);
  const isNew = !existing;
  const [x, setX] = useState(() => {
    if (existing) return { ...clone(existing), split: { rest: 'equal', lines: [], exact: {}, ...clone(existing.split ?? {}) } };
    const d = makeDraft(snap, me);
    // 旅の画面の電卓から「この金額で記録」で来たとき
    if (presetAmount) d.amount = parseAmount(presetAmount, d.currency);
    return d;
  });
  const [start] = useState(() => JSON.stringify(x));
  const [catTouched, setCatTouched] = useState(!!existing?.category);
  const [partTouched, setPartTouched] = useState(!!existing);
  const [curOpen, setCurOpen] = useState(false);
  const [showBaseAmt, setShowBaseAmt] = useState(!!existing?.baseAmount);
  const [scan, setScan] = useState(null);
  const [aiImg, setAiImg] = useState(null);
  const [receiptInfo, setReceiptInfo] = useState(null);
  const [showMore, setShowMore] = useState(!!(existing?.memo));
  const [calc, setCalc] = useState(null); // { initial, cur, apply }
  const openCalc = (value, c, apply) => setCalc({ initial: value ? toInputString(value, c) : '', cur: c, apply });
  const xRef = useRef(x);
  xRef.current = x;
  const scanToken = useRef(0);

  const validIds = snap.members.map((m) => m.id);
  const split = x.split;
  const cur = x.currency || base;
  const r = useMemo(() => expenseInBase(x, trip, validIds), [x, trip]);
  const detail = r.detail;
  const dirty = JSON.stringify(x) !== start;

  const set = (patch) => setX((p) => ({ ...p, ...patch }));
  const setSplit = (patch) => setX((p) => ({ ...p, split: { ...p.split, ...patch } }));

  // 旅の画面のカメラボタンから来たときは、すぐ読み取りを始める
  useEffect(() => {
    if (presetAmount && !autoReceipt) go(`/t/${tripId}/e/new`, { replace: true });
  }, []);
  // 支払額を変えたら、1人で払ったときの「払った額」も合わせる
  const setAmount = (v) => setX((p) => ({ ...p, amount: v, payers: p.payers && Object.keys(p.payers).length === 1 ? { [Object.keys(p.payers)[0]]: v } : p.payers }));
  useEffect(() => {
    if (!autoReceipt) return;
    go(`/t/${tripId}/e/new`, { replace: true });
    const f = takePendingReceipt();
    if (f) startReceipt(f);
  }, []);

  async function leave() {
    if (dirty && !(await confirmDialog({ title: '保存せずに戻りますか？', body: '入力した内容は消えます。', ok: '戻る', danger: true }))) return;
    back('/t/' + tripId);
  }

  // ---------- 通貨 ----------
  function changeCurrency(c) {
    setX((p) => {
      const f = 10 ** (decimals(c) - decimals(p.currency || base));
      const sc = (v) => (v == null ? v : Math.round(v * f));
      const s = { ...p.split };
      s.lines = (s.lines ?? []).map((l) => ({ ...l, amount: sc(l.amount) }));
      s.exact = Object.fromEntries(Object.entries(s.exact ?? {}).map(([k, v]) => [k, sc(v)]));
      const payers = p.payers ? Object.fromEntries(Object.entries(p.payers).map(([k, v]) => [k, sc(v)])) : null;
      return { ...p, currency: c, amount: sc(p.amount), split: s, payers, baseAmount: null };
    });
    setShowBaseAmt(false);
  }

  // ---------- 参加者 ----------
  function toggleMember(id) {
    setPartTouched(true);
    const ms = split.members.includes(id) ? split.members.filter((m) => m !== id) : [...split.members, id];
    setSplit({ members: validIds.filter((v) => ms.includes(v)) });
  }
  function setDate(d) {
    setX((p) => {
      const next = { ...p, date: d };
      if (!partTouched && d) next.split = { ...p.split, members: snap.members.filter((m) => presentOn(m, d)).map((m) => m.id) };
      return next;
    });
  }
  const prefs = getPrefs(tripId);
  const lastSame = (prefs.lastParticipants ?? []).filter((id) => validIds.includes(id));

  // ---------- 比率 ----------
  function toggleWeights(on) {
    if (!on) { setX((p) => { const s = { ...p.split }; delete s.weights; return { ...p, split: s }; }); return; }
    const last = prefs.lastWeights ?? {};
    setSplit({ weights: Object.fromEntries(validIds.map((id) => [id, last[id] ?? 1])) });
  }

  // ---------- 内訳 ----------
  const lines = split.lines ?? [];
  const setLines = (fn) => setX((p) => ({ ...p, split: { ...p.split, lines: fn(p.split.lines ?? []) } }));
  const addLine = () => setLines((ls) => [...ls, { id: newLineId(), name: '', amount: null, members: [] }]);
  const updLine = (id, patch) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const delLine = (id) => setLines((ls) => ls.filter((l) => l.id !== id));
  function toggleLineMember(line, mid) {
    const ms = line.members.includes(mid) ? line.members.filter((m) => m !== mid) : [...line.members, mid];
    updLine(line.id, { members: validIds.filter((v) => ms.includes(v)) });
  }
  // 「生ビール ×3」を1杯ずつの行に分ける
  function splitQty(line) {
    const q = line.qty || 1;
    const each = Math.floor((line.amount ?? 0) / q);
    const extra = (line.amount ?? 0) - each * q;
    const nm = (line.name || '').replace(/\s*[×x]\s*\d+$/, '');
    const parts = Array.from({ length: q }, (_, i) => ({ id: newLineId(), name: nm, orig: line.orig, amount: each + (i < extra ? 1 : 0), members: [], qty: 1 }));
    setLines((ls) => ls.flatMap((l) => (l.id === line.id ? parts : [l])));
  }
  function setMode(mode) {
    setX((p) => {
      const s = { ...p.split, mode };
      if (mode === 'items' && !(s.lines ?? []).length) s.lines = [{ id: newLineId(), name: '', amount: null, members: [] }];
      if (mode === 'exact') s.exact = s.exact ?? {};
      return { ...p, split: s };
    });
  }

  // ---------- 払った人 ----------
  const multiPay = !!x.payers;
  function toggleMultiPay() {
    if (multiPay) set({ payers: null });
    else set({ payers: { [x.paidBy]: x.amount ?? null } });
  }
  const paidSum = multiPay ? Object.values(x.payers).reduce((a, b) => a + (b || 0), 0) : 0;

  // ---------- レシート ----------
  async function startReceipt(file) {
    const cx = xRef.current;
    if (cx.split.mode === 'items' && (cx.split.lines ?? []).some((l) => l.amount)) {
      const ok = await confirmDialog({ title: '今の内訳を置き換えますか？', body: '読み取った品目で内訳を作り直します。', ok: '置き換える' });
      if (!ok) return;
    }
    let img;
    try { img = await compressImage(file); } catch { toast(AI_ERRORS.image); return; }
    await runReceipt(img);
  }
  async function runReceipt(img) {
    const token = ++scanToken.current;
    setScan({ thumb: img.thumb });
    try {
      await flushAll(); // 新しい旅がまだクラウドに無いと読み取れないので、先に送っておく
      const res = await readReceipt(tripId, img.base64, currencies);
      if (token !== scanToken.current) return;
      setScan(null);
      if (!res.ok) {
        if (res.error === 'nokey') { setAiImg(img); return; }
        toast(AI_ERRORS[res.error] ?? AI_ERRORS.server, { duration: 6000 });
        return;
      }
      applyReceipt(res.receipt);
    } catch (e) {
      if (token !== scanToken.current) return;
      setScan(null);
      toast(AI_ERRORS[e.kind] ?? AI_ERRORS.network, { duration: 6000 });
    }
  }
  function applyReceipt(rc) {
    const p = xRef.current;
    const c = currencies.includes(rc.currency) ? rc.currency : (p.currency || base);
    const toM = (v) => Math.round((Number(v) || 0) * 10 ** decimals(c));
    const newLines = (rc.items ?? []).map((it) => ({
      id: newLineId(),
      name: (it.ja || it.name) + (it.qty > 1 ? ` ×${it.qty}` : ''),
      orig: it.ja && it.name && it.ja !== it.name ? it.name : '',
      qty: it.qty || 1,
      amount: toM(it.price),
      members: [],
    }));
    const itemsSum = newLines.reduce((a, l) => a + l.amount, 0);
    const extras = (rc.taxIncluded ? 0 : toM(rc.tax)) + toM(rc.service) - toM(rc.discount);
    let total = toM(rc.total);
    if (!(total > 0)) total = itemsSum + extras;
    const gap = total - (itemsSum + extras);
    const tol = decimals(c) ? 2 : 1;
    const dOk = rc.date && Math.abs(Date.parse(rc.date) - Date.parse(todayStr())) <= 60 * 864e5;
    setX((q) => ({
      ...q,
      currency: c,
      amount: total,
      baseAmount: null,
      title: q.title || rc.store || '',
      category: catTouched ? q.category : (CATEGORIES.some((c) => c.id === rc.category) ? rc.category : (guessCategory(rc.store) ?? q.category)),
      date: dOk ? rc.date : q.date,
      split: { ...q.split, mode: 'items', lines: newLines, rest: 'prop' },
      source: 'ai',
    }));
    setReceiptInfo({ cur: c, itemsSum, tax: rc.taxIncluded ? 0 : toM(rc.tax), service: toM(rc.service), discount: toM(rc.discount), total, gap: Math.abs(gap) > tol ? gap : 0, taxIncluded: rc.taxIncluded });
    if (c !== (p.currency || base)) toast(`通貨を${curInfo(c).name}にしました`);
    toast(`${newLines.length}品目を読み取りました。だれの分かタップしてね`, { duration: 5000 });
  }
  function onPickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) startReceipt(f);
  }

  // ---------- 保存・削除 ----------
  function save() {
    const y = normalize(x);
    const rr = expenseInBase(y, trip, validIds);
    if (rr.problem) { toast(rr.problem); return; }
    if (!y.category) y.category = guessCategory(y.title) ?? 'other';
    saveExpense(tripId, y);
    setPrefs(tripId, {
      lastParticipants: y.split.members,
      lastWeights: y.split.weights ? { ...(prefs.lastWeights ?? {}), ...y.split.weights } : prefs.lastWeights,
      lastCurrency: y.currency,
    });
    toast(isNew ? '記録しました' : '保存しました');
    back('/t/' + tripId);
  }
  async function remove() {
    if (!(await confirmDialog({ title: 'この記録を削除しますか？', ok: '削除する', danger: true }))) return;
    const undo = deleteExpense(tripId, x.id);
    toast('削除しました', { action: '元に戻す', onAction: undo, duration: 6000 });
    back('/t/' + tripId);
  }

  const rate = rateOf(trip, cur);
  const baseEq = cur !== base && x.amount > 0 ? (x.baseAmount > 0 ? x.baseAmount : convertMinor(x.amount, cur, base, rate)) : null;
  const memberRows = snap.members;
  const maxShare = Math.max(1, ...Object.values(detail?.shares ?? {}));

  return html`<div class="page no-nav">
    <div class="topbar">
      <button class="icon-btn" aria-label="戻る" onClick=${leave}><${Icon} name="back" /></button>
      <h1>${isNew ? '記録する' : '記録を編集'}</h1>
      <label class="btn small" style=${{ cursor: 'pointer' }}>
        <input type="file" accept="image/*" hidden onChange=${onPickFile} />
        <${Icon} name="camera" size=${18} />レシート
      </label>
    </div>

    <!-- 金額 -->
    <div class="amount-box">
      <span class="sym" aria-hidden="true">${curInfo(cur).sym.trim()}</span>
      <${AmountField} big id="amount" value=${x.amount} cur=${cur} ariaLabel="支払った金額" placeholder="0" onChange=${setAmount} />
      <${CalcButton} big label="電卓で支払額を計算" onClick=${() => openCalc(x.amount, cur, setAmount)} />
      ${currencies.length > 1 ? html`<button type="button" class="cur-btn" onClick=${() => setCurOpen(true)} aria-label="通貨を変える">
        ${curInfo(cur).flag} ${cur}<${Icon} name="chevronDown" size=${16} /></button>` : null}
    </div>
    ${cur !== base ? html`<div class="row between small muted" style=${{ padding: '8px 6px 0' }}>
      <span class="num">${!rate ? 'レート未設定（設定 → 通貨とレート）' : baseEq != null ? `≈ ${fmt(baseEq, base)}${x.baseAmount > 0 ? '（実額）' : `（${fmtRate(cur, base, rate)}）`}` : fmtRate(cur, base, rate)}</span>
      <button type="button" class="link-btn" onClick=${() => setShowBaseAmt(!showBaseAmt)}>${showBaseAmt ? '閉じる' : 'カードの円額を入れる'}</button>
    </div>
    ${showBaseAmt ? html`<div class="row" style=${{ marginTop: '8px' }}>
      <span class="small muted grow">カード明細の請求額（わかれば。こちらを優先します）</span>
      <${CalcAmount} value=${x.baseAmount} cur=${base} ariaLabel="円での実際の支払額" placeholder=${baseEq != null ? toInputString(baseEq, base) : '0'}
        onChange=${(v) => set({ baseAmount: v })} onCalc=${() => openCalc(x.baseAmount, base, (v) => set({ baseAmount: v }))} />
    </div>` : null}` : null}

    <!-- 何に -->
    <div class="field" style=${{ marginTop: '16px' }}>
      <label for="title">何に使った？</label>
      <input id="title" class="input" placeholder="例）焼肉、タクシー、スーパーの買い出し" value=${x.title}
        onInput=${(e) => { const t = e.target.value; setX((p) => ({ ...p, title: t, category: catTouched ? p.category : (guessCategory(t) ?? p.category) })); }} />
    </div>
    <div class="cat-grid" role="radiogroup" aria-label="種類" style=${{ marginTop: '10px' }}>
      ${CATEGORIES.map((c) => html`<button type="button" key=${c.id} role="radio" aria-checked=${x.category === c.id}
        class=${'cat-btn' + (x.category === c.id ? ' on' : '')} onClick=${() => { setCatTouched(true); set({ category: c.id }); }}>
        <span class="e" aria-hidden="true">${c.emoji}</span>${c.label}</button>`)}
    </div>

    <!-- 払った人 -->
    <h2 class="section">だれが払った？
      <button type="button" class="link-btn" onClick=${toggleMultiPay}>${multiPay ? '1人で払った' : '複数人で払った'}</button>
    </h2>
    ${!multiPay ? html`<div class="chips" role="radiogroup" aria-label="払った人">
      ${memberRows.map((m) => html`<button type="button" key=${m.id} role="radio" aria-checked=${x.paidBy === m.id}
        class=${'chip' + (x.paidBy === m.id ? ' on' : '')} onClick=${() => set({ paidBy: m.id })}>
        <${Avatar} m=${m} />${m.name}${m.id === me ? html`<span class="tiny" style=${{ opacity: 0.7 }}>（あなた）</span>` : null}</button>`)}
    </div>` : html`<div class="card">
      ${memberRows.map((m) => html`<div class="split-row" key=${m.id}>
        <${Avatar} m=${m} /><span class="grow bold">${m.name}</span>
        <${CalcAmount} value=${x.payers[m.id] ?? null} cur=${cur} ariaLabel=${m.name + 'が払った額'}
          onChange=${(v) => setX((p) => ({ ...p, payers: { ...p.payers, [m.id]: v } }))}
          onCalc=${() => openCalc(x.payers[m.id], cur, (v) => setX((p) => ({ ...p, payers: { ...p.payers, [m.id]: v } })))} />
      </div>`)}
      <div class="small" style=${{ textAlign: 'right', marginTop: '6px' }}>
        ${x.amount > 0 && paidSum !== x.amount
          ? html`<span class="pay bold">${paidSum < x.amount ? `あと ${fmt(x.amount - paidSum, cur)}` : `${fmt(paidSum - x.amount, cur)} 多い`}</span>`
          : x.amount > 0 ? html`<span class="bold" style=${{ color: 'var(--ok)' }}>ぴったり ✓</span>` : null}
      </div>
    </div>`}

    <!-- だれで割る -->
    <h2 class="section">だれで割る？
      <span class="row" style=${{ gap: '4px' }}>
        <button type="button" class="link-btn" onClick=${() => { setPartTouched(true); setSplit({ members: validIds.slice() }); }}>全員</button>
        ${lastSame.length ? html`<button type="button" class="link-btn" onClick=${() => { setPartTouched(true); setSplit({ members: lastSame }); }}>前回と同じ</button>` : null}
      </span>
    </h2>
    <div class="chips" role="group" aria-label="割る人">
      ${memberRows.map((m) => {
        const on = split.members.includes(m.id);
        return html`<button type="button" key=${m.id} aria-pressed=${on} class=${'chip ' + (on ? 'on' : 'off')} onClick=${() => toggleMember(m.id)}>
          <${Avatar} m=${m} />${m.name}${on ? html`<${Icon} name="check" size=${16} />` : null}</button>`;
      })}
    </div>
    <div class="card flat" style=${{ marginTop: '10px', padding: '10px 14px' }}>
      <${Switch} on=${!!split.weights} onChange=${toggleWeights} label="比率をつける" sub="子どもは半額・よく飲む人は多め など">比率をつける<//>
      ${split.weights ? html`<div style=${{ marginTop: '6px' }}>
        ${memberRows.filter((m) => split.members.includes(m.id)).map((m) => html`<div class="split-row" key=${m.id}>
          <${Avatar} m=${m} size="sm" /><span class="grow">${m.name}</span>
          <${Stepper} value=${split.weights[m.id] ?? 1} onChange=${(v) => setSplit({ weights: { ...split.weights, [m.id]: v } })} />
        </div>`)}
      </div>` : null}
    </div>

    <!-- 分け方 -->
    <h2 class="section">どう分ける？</h2>
    <${Seg} label="分け方" value=${split.mode} onChange=${setMode} options=${[
      { value: 'equal', label: '均等に' },
      { value: 'items', label: '内訳で' },
      { value: 'exact', label: '一人ずつ' },
    ]} />
    <div class="tiny muted" style=${{ padding: '8px 4px 0' }}>
      ${split.mode === 'equal' ? '選んだ人で同じ額ずつ（比率をつけたらその割合で）。'
        : split.mode === 'items' ? 'スーパーで個人の物が混ざったとき、レストランで注文がバラバラのときに。行ごとに「だれの分か」を選び、選ばない行は「みんな」で割ります。'
        : 'それぞれが頼んだ額を入れて、残り（シェアした料理・税など）はみんなで割ります。'}
    </div>

    ${split.mode === 'items' ? html`<div class="card" style=${{ marginTop: '12px' }}>
      <div class="row">
        <label class="btn sun grow" style=${{ cursor: 'pointer' }}>
          <input type="file" accept="image/*" capture="environment" hidden onChange=${onPickFile} />
          <${Icon} name="sparkle" />レシートを撮って読み取る
        </label>
        <label class="btn" style=${{ cursor: 'pointer' }} aria-label="写真から選ぶ">
          <input type="file" accept="image/*" hidden onChange=${onPickFile} />
          <${Icon} name="image" />
        </label>
      </div>
      ${receiptInfo ? html`<div style=${{ marginTop: '10px' }}>
        ${receiptInfo.gap
          ? html`<${Note} kind="warn" icon="alert">品目の合計とレシートの合計が <b>${fmt(Math.abs(receiptInfo.gap), receiptInfo.cur)}</b> ずれています。読み違いがないか確かめてください（ずれはそのまま「残り」として配ります）。<//>`
          : html`<${Note} kind="sun" icon="sparkle">品目 ${fmt(receiptInfo.itemsSum, receiptInfo.cur)}${receiptInfo.tax ? ` ＋ 税 ${fmt(receiptInfo.tax, receiptInfo.cur)}` : ''}${receiptInfo.service ? ` ＋ サービス料 ${fmt(receiptInfo.service, receiptInfo.cur)}` : ''}${receiptInfo.discount ? ` − 割引 ${fmt(receiptInfo.discount, receiptInfo.cur)}` : ''} ＝ ${fmt(receiptInfo.total, receiptInfo.cur)} でレシートと一致しました。<//>`}
      </div>` : null}

      <div style=${{ marginTop: '8px' }}>
        ${lines.map((l) => html`<div class="line-item" key=${l.id}>
          <div class="top">
            <input class="input compact grow" placeholder="品目（なくてもOK）" value=${l.name ?? ''} aria-label="品目名"
              onInput=${(e) => updLine(l.id, { name: e.target.value })} />
            <${CalcAmount} value=${l.amount} cur=${cur} ariaLabel="品目の金額" onChange=${(v) => updLine(l.id, { amount: v })}
              onCalc=${() => openCalc(l.amount, cur, (v) => updLine(l.id, { amount: v }))} />
            <button type="button" class="icon-btn" aria-label="この行を消す" onClick=${() => delLine(l.id)}><${Icon} name="close" size=${18} /></button>
          </div>
          ${l.orig ? html`<div class="orig">${l.orig}</div>` : null}
          <div class="who" role="group" aria-label="だれの分">
            <button type="button" class=${'who-btn all' + (!l.members.length ? ' on' : '')} aria-pressed=${!l.members.length}
              onClick=${() => updLine(l.id, { members: [] })}>みんな</button>
            ${memberRows.map((m) => {
              const on = l.members.includes(m.id);
              return html`<button type="button" key=${m.id} class=${'who-btn ' + (on ? 'on' : 'off')} aria-pressed=${on}
                aria-label=${m.name} title=${m.name} onClick=${() => toggleLineMember(l, m.id)}><${Avatar} m=${m} /></button>`;
            })}
            ${(l.qty ?? 1) > 1 && l.members.length === 0 ? html`<button type="button" class="link-btn" onClick=${() => splitQty(l)}>${l.qty}つに分ける</button>` : null}
          </div>
        </div>`)}
      </div>
      <button type="button" class="btn small" style=${{ marginTop: '8px' }} onClick=${addLine}><${Icon} name="plus" size=${16} />行を追加</button>
      <${RestBox} x=${x} detail=${detail} cur=${cur} onRest=${(v) => setSplit({ rest: v })}
        onFit=${() => set({ amount: detail?.linesTotal ?? 0 })} kind="items" />
    </div>` : null}

    ${split.mode === 'exact' ? html`<div class="card" style=${{ marginTop: '12px' }}>
      ${memberRows.filter((m) => split.members.includes(m.id)).map((m) => html`<div class="split-row" key=${m.id}>
        <${Avatar} m=${m} /><span class="grow bold">${m.name}</span>
        <${CalcAmount} value=${split.exact?.[m.id] ?? null} cur=${cur} ariaLabel=${m.name + 'の分'}
          onChange=${(v) => setX((p) => ({ ...p, split: { ...p.split, exact: { ...(p.split.exact ?? {}), [m.id]: v } } }))}
          onCalc=${() => openCalc(split.exact?.[m.id], cur, (v) => setX((p) => ({ ...p, split: { ...p.split, exact: { ...(p.split.exact ?? {}), [m.id]: v } } })))} />
      </div>`)}
      <${RestBox} x=${x} detail=${detail} cur=${cur} onRest=${(v) => setSplit({ rest: v })}
        onFit=${() => set({ amount: detail?.linesTotal ?? 0 })} kind="exact" />
    </div>` : null}

    <!-- 負担のプレビュー -->
    <h2 class="section">負担額 <span class="aside">${cur !== base ? `円換算は ${fmtRate(cur, base, rate)}` : ''}</span></h2>
    <div class="card">
      ${r.problem && !(r.problem === '金額を入れてください' && !x.amount)
        ? html`<${Note} kind="warn" icon="alert">${r.problem}<//>`
        : !x.amount ? html`<div class="small faint">金額を入れると、ここに一人ずつの負担額が出ます。</div>`
        : html`<div class="preview">
          ${memberRows.filter((m) => detail?.shares?.[m.id]).map((m) => html`<div class="p" key=${m.id}>
            <${Avatar} m=${m} size="sm" />
            <span style=${{ minWidth: '4.5em' }} class="small bold ellipsis">${m.name}</span>
            <span class="bar" aria-hidden="true"><i style=${{ width: `${(100 * detail.shares[m.id]) / maxShare}%` }}></i></span>
            <span class="v">${fmt(detail.shares[m.id], cur)}${cur !== base && r.shares?.[m.id] != null ? html`<span class="tiny muted" style=${{ display: 'block', fontWeight: 500 }}>≈ ${fmt(r.shares[m.id], base)}</span>` : null}</span>
          </div>`)}
        </div>`}
    </div>

    <!-- 日付・メモ -->
    <div class="row" style=${{ marginTop: '16px', alignItems: 'flex-end' }}>
      <div class="field grow">
        <label for="date">日付</label>
        <input id="date" type="date" class="input" value=${x.date} onInput=${(e) => setDate(e.target.value)} />
      </div>
      ${!showMore ? html`<button type="button" class="btn" onClick=${() => setShowMore(true)}><${Icon} name="edit" size=${18} />メモ</button>` : null}
    </div>
    ${showMore ? html`<div class="field" style=${{ marginTop: '12px' }}>
      <label for="memo">メモ</label>
      <textarea id="memo" class="input" rows="2" placeholder="例）ゆいの分は後で現金でもらった" value=${x.memo ?? ''} onInput=${(e) => set({ memo: e.target.value })}></textarea>
    </div>` : null}

    ${!isNew ? html`<div style=${{ marginTop: '24px' }}>
      <div class="tiny faint" style=${{ textAlign: 'center', marginBottom: '8px' }}>
        ${existing?.updatedBy && snap.memberById.get(existing.updatedBy) ? `最後に編集: ${snap.memberById.get(existing.updatedBy).name}` : ''}
      </div>
      <button type="button" class="btn ghost danger block" onClick=${remove}><${Icon} name="trash" size=${18} />この記録を削除</button>
    </div>` : null}

    <div class="bottom-bar"><div class="inner">
      <button type="button" class="btn primary block" onClick=${save} disabled=${!!r.problem}>
        ${r.problem && x.amount ? r.problem.length > 20 ? '内容を確認してください' : r.problem : isNew ? '記録する' : '保存する'}
      </button>
    </div></div>

    <${Sheet} open=${curOpen} onClose=${() => setCurOpen(false)} title="通貨">
      <div class="list">
        ${currencies.map((c) => html`<button key=${c} class="list-item" onClick=${() => { changeCurrency(c); setCurOpen(false); }}>
          <span style=${{ fontSize: '22px' }}>${curInfo(c).flag}</span>
          <span class="grow bold">${curInfo(c).name}</span>
          ${c === cur ? html`<${Icon} name="check" />` : null}
        </button>`)}
      </div>
      <div class="tiny faint" style=${{ marginTop: '10px' }}>通貨を増やすには、旅の「設定」→「通貨とレート」から。</div>
    <//>

    ${scan ? html`<div class="scan-overlay" role="alertdialog" aria-label="レシートを読み取り中">
      <div class="scan-card">
        <div class="scan-receipt" style=${{ backgroundImage: `url(${scan.thumb})` }}></div>
        <div class="bold">レシートを読み取っています…</div>
        <div class="small muted" style=${{ margin: '4px 0 14px' }}>品目と金額をAIが書き出しています（10秒ほど）</div>
        <button class="btn small" onClick=${() => { scanToken.current++; setScan(null); }}>やめる</button>
      </div>
    </div>` : null}

    <${AiSetupSheet} open=${!!aiImg} tripId=${tripId} onClose=${() => setAiImg(null)}
      onReady=${() => { const img = aiImg; setAiImg(null); if (img) runReceipt(img); }} />

    <${CalcSheet} open=${!!calc} onClose=${() => setCalc(null)} initial=${calc?.initial ?? ''} cur=${calc?.cur ?? cur}
      onApply=${(v) => calc?.apply(v)} />
  </div>`;
}

// 合計と内訳の差（税・サービス料・割引）の扱い
function RestBox({ x, detail, cur, onRest, onFit, kind }) {
  if (!detail) return null;
  const rest = detail.rest;
  const lt = detail.linesTotal;
  if (!x.amount && lt) {
    return html`<div class="rest-box">
      <div class="small">内訳の合計 <b class="num">${fmt(lt, cur)}</b></div>
      <button type="button" class="btn small" onClick=${onFit}>支払額をこの合計にする</button>
    </div>`;
  }
  if (!x.amount) return null;
  return html`<div class="rest-box">
    <div class="row between small">
      <span>${kind === 'items' ? '内訳の合計' : '一人ずつの合計'}</span>
      <span class="num bold">${fmt(lt, cur)} / ${fmt(x.amount, cur)}</span>
    </div>
    ${rest === 0
      ? html`<div class="small bold" style=${{ color: 'var(--ok)' }}>支払額とぴったり ✓</div>`
      : html`<div class="small">
          ${rest > 0
            ? html`残り <b class="num">${fmt(rest, cur)}</b>（${kind === 'items' ? '内訳に入れていない分・税など' : 'シェアした料理・税など'}）の分け方`
            : html`内訳が <b class="num">${fmt(-rest, cur)}</b> 多いので、割引として配ります`}
        </div>
        <${Seg} small label="残りの分け方" value=${x.split.rest === 'prop' ? 'prop' : 'equal'} onChange=${onRest} options=${[
          { value: 'equal', label: 'みんなで均等' },
          { value: 'prop', label: '頼んだ額に比例' },
        ]} />
        <div class="tiny muted">${x.split.rest === 'prop'
          ? '税やサービス料のように、たくさん頼んだ人ほど多く負担します'
          : '「だれで割る？」で選んだ人で同じ額ずつ（スーパーの共有分など）'}</div>`}
  </div>`;
}

// 精算の送金の記録を直す
function TransferEditor({ snap, existing }) {
  const tripId = snap.id;
  const base = snap.trip.base || 'JPY';
  const [t, setT] = useState(() => clone(existing));
  const ok = t.from && t.to && t.from !== t.to && t.amount > 0;
  function save() {
    saveExpense(tripId, t);
    toast('保存しました');
    back(`/t/${tripId}/settle`);
  }
  async function remove() {
    if (!(await confirmDialog({ title: 'この送金の記録を削除しますか？', body: '精算の残りが元に戻ります。', ok: '削除する', danger: true }))) return;
    const undo = deleteExpense(tripId, t.id);
    toast('削除しました', { action: '元に戻す', onAction: undo, duration: 6000 });
    back(`/t/${tripId}/settle`);
  }
  return html`<div class="page no-nav">
    <div class="topbar">
      <button class="icon-btn" aria-label="戻る" onClick=${() => back(`/t/${tripId}/settle`)}><${Icon} name="back" /></button>
      <h1>送金の記録</h1>
    </div>
    <${TransferFields} snap=${snap} t=${t} setT=${setT} />
    <button type="button" class="btn ghost danger block" style=${{ marginTop: '24px' }} onClick=${remove}><${Icon} name="trash" size=${18} />この記録を削除</button>
    <div class="bottom-bar"><div class="inner"><button class="btn primary block" disabled=${!ok} onClick=${save}>保存する</button></div></div>
  </div>`;
}

export function TransferFields({ snap, t, setT }) {
  const base = snap.trip.base || 'JPY';
  return html`<div class="stack">
    <div class="field"><span class="label">払った人</span>
      <div class="chips">${snap.members.map((m) => html`<button type="button" key=${m.id} class=${'chip' + (t.from === m.id ? ' on' : '')}
        aria-pressed=${t.from === m.id} onClick=${() => setT({ ...t, from: m.id })}><${Avatar} m=${m} />${m.name}</button>`)}</div>
    </div>
    <div class="field"><span class="label">受け取った人</span>
      <div class="chips">${snap.members.filter((m) => m.id !== t.from).map((m) => html`<button type="button" key=${m.id} class=${'chip' + (t.to === m.id ? ' on' : '')}
        aria-pressed=${t.to === m.id} onClick=${() => setT({ ...t, to: m.id })}><${Avatar} m=${m} />${m.name}</button>`)}</div>
    </div>
    <div class="field"><label for="tamt">金額（${curInfo(base).name}）</label>
      <div class="amount-box"><span class="sym">${curInfo(base).sym.trim()}</span>
        <${AmountField} big id="tamt" value=${t.amount} cur=${base} ariaLabel="送金額" onChange=${(v) => setT({ ...t, amount: v })} />
      </div>
    </div>
    <div class="field"><label for="tdate">日付</label>
      <input id="tdate" type="date" class="input" value=${t.date} onInput=${(e) => setT({ ...t, date: e.target.value })} />
    </div>
  </div>`;
}

export function newTransfer(from, to, amount, base) {
  return { id: newExpenseId(), kind: 'transfer', from, to, amount, currency: base, date: todayStr(), title: '精算', memo: '' };
}
