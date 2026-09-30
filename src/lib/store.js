// データの置き場所と同期。
//
// ・ローカルファースト：画面はいつも端末内(IndexedDB)のデータで動く。電波が無くても記録できる。
// ・変更は「送信待ち(outbox)」にためて、つながったらまとめてクラウドへ送る。
// ・クラウドからは差分だけ取り込む。送信待ちの行は端末側を優先（自分の変更を巻き戻さない）。
// ・クラウドに旅が無い（消えた）のに端末に記録があれば、端末の記録からクラウドを復元する。
//   端末のデータを「クラウドが空だから」という理由で消すことは絶対にしない。
// ・誰かが保存したら Realtime のブロードキャストで他の人の画面にすぐ知らせる（保険で30秒ごとにも確認）。
import { idb } from './idb.js';
import { rpcPull, rpcPush, supabase } from './api.js';
import { newTripId, newMemberId } from './ids.js';

const K_INDEX = 'index';
const K_OUTBOX = 'outbox';
const kTrip = (id) => 't:' + id;
const nowIso = () => new Date().toISOString();
const ts = (x) => Date.parse(x?.updatedAt ?? '') || 0;

const S = {
  index: [],            // [{ id, openedAt, addedAt }]
  trips: new Map(),     // id -> { trip, members: Map, expenses: Map, cursor }
  outbox: [],           // [{ tripId, kind, id, data }]
  sync: new Map(),      // id -> { state, lastSync, error, restored }
  storageOk: true,
};

// ---------------------------------------------------------------------
// 変更通知（React からは useSyncExternalStore で購読）
// ---------------------------------------------------------------------
let version = 0;
const listeners = new Set();
const snapCache = new Map();
function emit() {
  version++;
  snapCache.clear();
  for (const f of listeners) f();
}
export const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const getVersion = () => version;

// ---------------------------------------------------------------------
// 端末への保存
// ---------------------------------------------------------------------
const saveTimers = new Map();
function persistTrip(id) {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(id, setTimeout(() => {
    const e = S.trips.get(id);
    if (!e) return;
    idb.set(kTrip(id), {
      trip: e.trip,
      members: [...e.members.values()],
      expenses: [...e.expenses.values()],
      cursor: e.cursor,
    }).catch(storageFailed);
  }, 120));
}
const persistIndex = () => idb.set(K_INDEX, S.index).catch(storageFailed);
const persistOutbox = () => idb.set(K_OUTBOX, S.outbox).catch(storageFailed);
function storageFailed(err) {
  console.warn('storage', err);
  if (S.storageOk) { S.storageOk = false; emit(); }
}
export const storageOk = () => S.storageOk;

function hydrate(raw) {
  return {
    trip: raw?.trip ?? null,
    members: new Map((raw?.members ?? []).map((m) => [m.id, m])),
    expenses: new Map((raw?.expenses ?? []).map((x) => [x.id, x])),
    cursor: raw?.cursor ?? null,
  };
}
function entry(id) {
  let e = S.trips.get(id);
  if (!e) { e = hydrate(null); S.trips.set(id, e); }
  return e;
}
function touchIndex(id) {
  const now = Date.now();
  const it = S.index.find((x) => x.id === id);
  if (it) it.openedAt = now;
  else S.index.push({ id, openedAt: now, addedAt: now });
  persistIndex();
}

// ---------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------
export async function init() {
  try {
    S.index = (await idb.get(K_INDEX)) ?? [];
    S.outbox = (await idb.get(K_OUTBOX)) ?? [];
    for (const it of S.index) S.trips.set(it.id, hydrate(await idb.get(kTrip(it.id))));
  } catch (err) {
    storageFailed(err);
  }
  window.addEventListener('online', () => { flushAll(); pullOpen(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { flushAll(); pullOpen(); }
  });
  setInterval(() => { if (document.visibilityState === 'visible') { pullOpen(); if (S.outbox.length) flushAll(); } }, 30000);
  try { navigator.storage?.persist?.(); } catch { /* 無くても動く */ }
  flushAll();
  emit();
}

// ---------------------------------------------------------------------
// 読み出し
// ---------------------------------------------------------------------
const byOrder = (a, b) => ((a.order ?? 0) - (b.order ?? 0)) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
const byNewest = (a, b) =>
  String(b.date ?? '').localeCompare(String(a.date ?? '')) ||
  String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));

export function getTrip(id) {
  if (!id) return null;
  if (snapCache.has(id)) return snapCache.get(id);
  const e = S.trips.get(id);
  if (!e) return null;
  const all = [...e.members.values()].sort(byOrder);
  const snap = {
    id,
    trip: e.trip,
    members: all.filter((m) => !m.removed),
    allMembers: all,
    expenses: [...e.expenses.values()].filter((x) => !x.deleted).sort(byNewest),
    memberById: new Map(all.map((m) => [m.id, m])),
  };
  snapCache.set(id, snap);
  return snap;
}
export function getExpense(tripId, eid) {
  return S.trips.get(tripId)?.expenses.get(eid) ?? null;
}
export function listTrips() {
  return S.index
    .slice()
    .sort((a, b) => b.openedAt - a.openedAt)
    .map((it) => getTrip(it.id))
    .filter((s) => s && s.trip);
}
export const getSync = (id) => S.sync.get(id) ?? { state: 'idle' };
export const pendingCount = (id) => S.outbox.filter((o) => !id || o.tripId === id).length;
function setSync(id, patch) {
  S.sync.set(id, { ...getSync(id), ...patch });
  emit();
}

// この端末で「自分」はどのメンバーか（端末ごと・旅ごと）
export function getMe(tripId) {
  try { return localStorage.getItem('tabiwari:me:' + tripId) || null; } catch { return null; }
}
export function setMe(tripId, memberId) {
  try {
    if (memberId) localStorage.setItem('tabiwari:me:' + tripId, memberId);
    else localStorage.removeItem('tabiwari:me:' + tripId);
  } catch { /* 覚えられなくても動く */ }
  emit();
}
// 旅ごとの小さな設定（前回の比率・前回の参加者など）
export function getPrefs(tripId) {
  try { return JSON.parse(localStorage.getItem('tabiwari:prefs:' + tripId) || '{}') || {}; } catch { return {}; }
}
export function setPrefs(tripId, patch) {
  try { localStorage.setItem('tabiwari:prefs:' + tripId, JSON.stringify({ ...getPrefs(tripId), ...patch })); } catch { /* 無視 */ }
}

// ---------------------------------------------------------------------
// 変更
// ---------------------------------------------------------------------
function enqueue(tripId, kind, data) {
  const i = S.outbox.findIndex((o) => o.tripId === tripId && o.kind === kind && o.id === data.id);
  const op = { tripId, kind, id: data.id, data };
  if (i >= 0) S.outbox[i] = op;
  else S.outbox.push(op);
  persistOutbox();
  scheduleFlush();
}

export function createTrip(trip, members) {
  const id = newTripId();
  const t = nowIso();
  const e = entry(id);
  e.trip = { ...trip, id, createdAt: t, updatedAt: t };
  e.cursor = null;
  enqueue(id, 'trip', e.trip);
  members.forEach((m, i) => {
    const mm = { ...m, id: m.id ?? newMemberId(), order: i, createdAt: t, updatedAt: t };
    e.members.set(mm.id, mm);
    enqueue(id, 'member', mm);
  });
  touchIndex(id);
  persistTrip(id);
  emit();
  return id;
}

export function updateTrip(id, patch) {
  const e = entry(id);
  if (!e.trip) return;
  e.trip = { ...e.trip, ...patch, updatedAt: nowIso() };
  enqueue(id, 'trip', e.trip);
  persistTrip(id);
  emit();
}

export function saveMember(tripId, m) {
  const e = entry(tripId);
  const t = nowIso();
  const prev = m.id ? e.members.get(m.id) : null;
  const orderMax = Math.max(-1, ...[...e.members.values()].map((x) => x.order ?? 0));
  const mm = {
    ...prev,
    ...m,
    id: m.id ?? newMemberId(),
    order: prev?.order ?? orderMax + 1,
    createdAt: prev?.createdAt ?? t,
    updatedAt: t,
  };
  e.members.set(mm.id, mm);
  enqueue(tripId, 'member', mm);
  persistTrip(tripId);
  emit();
  return mm;
}

export function saveExpense(tripId, x) {
  const e = entry(tripId);
  const t = nowIso();
  const prev = e.expenses.get(x.id);
  const me = getMe(tripId);
  const xx = {
    ...x,
    createdAt: prev?.createdAt ?? x.createdAt ?? t,
    createdBy: prev?.createdBy ?? x.createdBy ?? me ?? null,
    updatedBy: me ?? null,
    updatedAt: t,
  };
  e.expenses.set(xx.id, xx);
  enqueue(tripId, 'expense', xx);
  persistTrip(tripId);
  emit();
  return xx;
}

// 削除は「消した印」を付けるだけ。戻す関数を返す
export function deleteExpense(tripId, eid) {
  const cur = getExpense(tripId, eid);
  if (!cur) return () => {};
  saveExpense(tripId, { ...cur, deleted: true });
  return () => {
    const now = getExpense(tripId, eid);
    if (now) saveExpense(tripId, { ...now, deleted: false });
  };
}

// この端末の一覧から外す（クラウドのデータは消さない。リンクからまた開ける）
export async function forgetTrip(id) {
  S.index = S.index.filter((x) => x.id !== id);
  persistIndex();
  if (!S.outbox.some((o) => o.tripId === id)) {
    S.trips.delete(id);
    idb.del(kTrip(id)).catch(() => {});
  }
  closeTrip(id);
  emit();
}

// バックアップ(JSON)を書き出す／取り込む
export function exportTrip(id) {
  const e = S.trips.get(id);
  if (!e?.trip) return null;
  return {
    format: 'tabiwari',
    version: 1,
    exportedAt: nowIso(),
    trip: e.trip,
    members: [...e.members.values()],
    expenses: [...e.expenses.values()],
  };
}
export function importTrip(json) {
  if (!json || json.format !== 'tabiwari' || !json.trip?.id) throw new Error('たびわりのバックアップファイルではないようです');
  const id = json.trip.id;
  const e = entry(id);
  if (!e.trip || ts(json.trip) >= ts(e.trip)) e.trip = json.trip;
  for (const m of json.members ?? []) {
    const cur = e.members.get(m.id);
    if (!cur || ts(m) >= ts(cur)) e.members.set(m.id, m);
  }
  for (const x of json.expenses ?? []) {
    const cur = e.expenses.get(x.id);
    if (!cur || ts(x) >= ts(cur)) e.expenses.set(x.id, x);
  }
  // クラウドにも送る（クラウド側は新しいほうだけ残すので、上書き事故は起きない）
  enqueueAll(id);
  touchIndex(id);
  persistTrip(id);
  emit();
  return id;
}
function enqueueAll(id) {
  const e = S.trips.get(id);
  if (!e?.trip) return;
  enqueue(id, 'trip', e.trip);
  for (const m of e.members.values()) enqueue(id, 'member', m);
  for (const x of e.expenses.values()) enqueue(id, 'expense', x);
}

// ---------------------------------------------------------------------
// 同期：送る
// ---------------------------------------------------------------------
let flushing = false;
let flushAgain = false;
let flushTimer = null;
let retryTimer = null;
function scheduleFlush(ms = 250) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushAll, ms);
}
export async function flushAll() {
  if (flushing) { flushAgain = true; return; }
  if (!S.outbox.length) return;
  flushing = true;
  try {
    const ids = [...new Set(S.outbox.map((o) => o.tripId))];
    for (const tid of ids) await flushTrip(tid, 0);
  } finally {
    flushing = false;
    if (flushAgain) { flushAgain = false; scheduleFlush(50); }
  }
}
async function flushTrip(tid, depth) {
  const ops = S.outbox.filter((o) => o.tripId === tid).slice(0, 200);
  if (!ops.length) return;
  setSync(tid, { state: 'syncing' });
  try {
    await rpcPush(tid, ops.map((o) => ({ kind: o.kind, data: o.data })));
    S.outbox = S.outbox.filter((o) => !ops.includes(o));
    persistOutbox();
    setSync(tid, { state: 'idle', lastSync: Date.now(), error: null });
    broadcast(tid);
    if (S.outbox.some((o) => o.tripId === tid) && depth < 20) await flushTrip(tid, depth + 1);
  } catch (err) {
    // クラウドに旅が無い → 旅そのものを先頭に入れて送り直す（復元）
    if (err.kind === 'notrip' && depth < 2) {
      const e = S.trips.get(tid);
      if (e?.trip) {
        S.outbox = S.outbox.filter((o) => !(o.tripId === tid && o.kind === 'trip'));
        S.outbox.unshift({ tripId: tid, kind: 'trip', id: tid, data: e.trip });
        persistOutbox();
        return flushTrip(tid, depth + 1);
      }
    }
    setSync(tid, { state: err.kind === 'network' ? 'offline' : 'error', error: String(err.message ?? err) });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flushAll, err.kind === 'network' ? 20000 : 60000);
  }
}

// ---------------------------------------------------------------------
// 同期：受け取る
// ---------------------------------------------------------------------
const pulling = new Map();
export function pull(tid) {
  if (pulling.has(tid)) return pulling.get(tid);
  const p = (async () => {
    const e = entry(tid);
    // 同時刻に書かれた行の取りこぼしを防ぐため、しおりは15秒さかのぼって重ねて取る
    const since = e.cursor ? new Date(Date.parse(e.cursor) - 15000).toISOString() : null;
    if (!e.trip) setSync(tid, { state: 'syncing' });
    try {
      const res = await rpcPull(tid, since);
      if (!res?.found) {
        if (e.trip) {
          // クラウドに旅が無い。端末の記録から送り直す（端末側は消さない）。
          // 一度クラウドで確かめた旅（cursor あり）なら「消えていたので復元した」ことを知らせる。
          // 作ったばかりでまだ送れていないだけの旅なら、そのまま送るだけ
          enqueueAll(tid);
          if (e.cursor) setSync(tid, { restored: true });
          flushAll();
        } else {
          setSync(tid, { state: 'notfound' });
        }
        return;
      }
      merge(tid, res);
      e.cursor = res.now;
      persistTrip(tid);
      if (e.trip && !S.index.some((x) => x.id === tid)) touchIndex(tid);
      const st = getSync(tid).state;
      setSync(tid, {
        state: pendingCount(tid) ? (st === 'offline' || st === 'error' ? st : 'syncing') : 'idle',
        lastSync: Date.now(),
        error: null,
      });
    } catch (err) {
      setSync(tid, { state: err.kind === 'network' ? 'offline' : 'error', error: String(err.message ?? err) });
    } finally {
      pulling.delete(tid);
    }
  })();
  pulling.set(tid, p);
  return p;
}

function merge(tid, res) {
  const e = entry(tid);
  const pending = new Set(S.outbox.filter((o) => o.tripId === tid).map((o) => o.kind + ':' + o.id));
  let changed = false;
  if (res.trip && !pending.has('trip:' + tid) && (!e.trip || ts(res.trip) >= ts(e.trip))) {
    e.trip = res.trip;
    changed = true;
  }
  for (const m of res.members ?? []) {
    if (pending.has('member:' + m.id)) continue;
    const cur = e.members.get(m.id);
    if (!cur || ts(m) >= ts(cur)) { e.members.set(m.id, m); changed = true; }
  }
  for (const x of res.expenses ?? []) {
    if (pending.has('expense:' + x.id)) continue;
    const cur = e.expenses.get(x.id);
    if (!cur || ts(x) >= ts(cur)) { e.expenses.set(x.id, x); changed = true; }
  }
  if (changed) emit();
}

// ---------------------------------------------------------------------
// 開いている旅：リアルタイム通知
// ---------------------------------------------------------------------
const openSet = new Set();
const channels = new Map();
function pullOpen() { for (const tid of openSet) pull(tid); }

export function openTrip(tid) {
  openSet.add(tid);
  if (entry(tid).trip) touchIndex(tid);
  pull(tid).then(() => flushAll());
  if (!channels.has(tid)) {
    try {
      const ch = supabase.channel('tabiwari-' + tid, { config: { broadcast: { self: false } } });
      ch.on('broadcast', { event: 'changed' }, () => pull(tid)).subscribe();
      channels.set(tid, ch);
    } catch { /* 30秒ごとの確認で追いつく */ }
  }
}
export function closeTrip(tid) {
  openSet.delete(tid);
  const ch = channels.get(tid);
  if (ch) { try { supabase.removeChannel(ch); } catch { /* 無視 */ } channels.delete(tid); }
}
function broadcast(tid) {
  const ch = channels.get(tid);
  if (!ch) return;
  try { ch.send({ type: 'broadcast', event: 'changed', payload: { at: Date.now() } }); } catch { /* 無視 */ }
}
