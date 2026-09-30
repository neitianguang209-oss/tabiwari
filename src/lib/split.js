// 割り勘の計算（画面やDBに依存しない純粋関数だけ）。
//
// 1件の支出の分け方 split.mode は3種類：
//   equal : 参加者で均等（weights があれば比率で）
//   items : 内訳。行ごとに「誰の分か」を付ける。誰も付いていない行は参加者みんなで割る。
//           合計と内訳の差（税・サービス料・割引）は rest に従って配る
//   exact : 一人ずつの金額。合計との差は rest に従って配る
// rest: 'equal' = 参加者で均等（比率があれば比率で） / 'prop' = それぞれの負担額に比例
//
// 端数は「最大剰余法」で配る：合計は必ず支払額ぴったり。
// 同点のときの1円は支出IDと人IDから決まる順で配るので、毎回同じ人に偏らない。

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

// 文字列 → 32bit ハッシュ（同点の順番決め用）
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 実数の配列を、合計が total（整数）になるよう整数に丸める
export function roundToTotal(reals, total, tieKeys = []) {
  const n = reals.length;
  if (!n) return [];
  const floors = reals.map((v) => Math.floor(v + 1e-9));
  let rem = Math.round(total - sum(floors));
  const order = reals
    .map((v, i) => ({ i, frac: v - floors[i], tie: hash(String(tieKeys[i] ?? i)) }))
    .sort((a, b) => (b.frac - a.frac) || (a.tie - b.tie));
  const out = floors.slice();
  let k = 0;
  while (rem > 0) { out[order[k % n].i] += 1; rem--; k++; }
  k = n - 1;
  while (rem < 0) { out[order[((k % n) + n) % n].i] -= 1; rem++; k--; }
  return out;
}

// total を weights の比で整数に分ける（weights が全部0なら均等）
export function allocate(total, weights, tieKeys = []) {
  const n = weights.length;
  if (!n) return [];
  const w = weights.map((x) => (x > 0 ? x : 0));
  const W = sum(w);
  const reals = W > 0 ? w.map((x) => (total * x) / W) : w.map(() => total / n);
  return roundToTotal(reals, total, tieKeys);
}

function weightOf(split, id) {
  if (!split.weights) return 1;
  const w = Number(split.weights[id]);
  return isFinite(w) && w >= 0 ? w : 1;
}

// 実数の負担額 {id: real} に amount を配って足す
function spread(target, amount, ids, weightFn) {
  if (!amount || !ids.length) return;
  const ws = ids.map(weightFn).map((x) => (x > 0 ? x : 0));
  const W = sum(ws);
  ids.forEach((id, i) => {
    const part = W > 0 ? (amount * ws[i]) / W : amount / ids.length;
    target[id] = (target[id] ?? 0) + part;
  });
}

// 残り（税など）を配る。prop なら負担額に比例、足場が無ければ参加者で
function spreadRest(base, rest, split, participants) {
  if (!rest) return;
  if (split.rest === 'prop') {
    const ids = Object.keys(base).filter((id) => base[id] > 0);
    if (ids.length) { spread(base, rest, ids, (id) => base[id]); return; }
  }
  spread(base, rest, participants, (id) => weightOf(split, id));
}

/**
 * 1件の支出の負担額（支出の通貨の最小単位）を求める。
 * @returns {{ shares: Record<string, number>, rest: number, linesTotal: number, problem: string|null }}
 */
export function computeShares(exp, validIds) {
  const total = Math.round(exp.amount ?? 0);
  const split = exp.split ?? { mode: 'equal', members: [] };
  const valid = validIds ? new Set(validIds) : null;
  const ok = (id) => !valid || valid.has(id);
  const participants = (split.members ?? []).filter(ok);
  const out = { shares: {}, rest: 0, linesTotal: 0, problem: null };

  if (!(total > 0)) { out.problem = '金額を入れてください'; return out; }

  const real = {};
  if (split.mode === 'items') {
    let pool = 0;
    for (const line of split.lines ?? []) {
      const amt = Math.round(line.amount ?? 0);
      out.linesTotal += amt;
      const ms = (line.members ?? []).filter(ok);
      if (ms.length) spread(real, amt, ms, () => 1);
      else pool += amt;
    }
    if (pool && !participants.length) { out.problem = '「みんな」に入る人を選んでください'; return out; }
    spread(real, pool, participants, (id) => weightOf(split, id));
    out.rest = total - out.linesTotal;
    if (out.rest && split.rest !== 'prop' && !participants.length) { out.problem = '残りを割る人を選んでください'; return out; }
    spreadRest(real, out.rest, split, participants);
  } else if (split.mode === 'exact') {
    for (const [id, v] of Object.entries(split.exact ?? {})) {
      if (!ok(id)) continue;
      const amt = Math.round(v ?? 0);
      if (!amt) continue;
      real[id] = (real[id] ?? 0) + amt;
      out.linesTotal += amt;
    }
    out.rest = total - out.linesTotal;
    if (out.rest && !Object.keys(real).length && !participants.length) { out.problem = '負担する人を選んでください'; return out; }
    if (out.rest && split.rest !== 'prop' && !participants.length) { out.problem = '残りを割る人を選んでください'; return out; }
    spreadRest(real, out.rest, split, participants);
  } else {
    if (!participants.length) { out.problem = '割る人を1人以上選んでください'; return out; }
    spread(real, total, participants, (id) => weightOf(split, id));
  }

  const ids = Object.keys(real);
  if (!ids.length) { out.problem = '負担する人がいません'; return out; }
  const ints = roundToTotal(ids.map((id) => real[id]), total, ids.map((id) => (exp.id ?? '') + ':' + id));
  ids.forEach((id, i) => { if (ints[i] !== 0) out.shares[id] = ints[i]; });
  if (ints.some((v) => v < 0)) out.problem = '負担がマイナスになる人がいます。内訳を見直してください';
  return out;
}

// 支払った人の内訳（1人なら paidBy、複数なら payers）
export function paidMap(exp) {
  if (exp.payers && Object.keys(exp.payers).length) {
    const m = {};
    for (const [id, v] of Object.entries(exp.payers)) if (Math.round(v)) m[id] = Math.round(v);
    return m;
  }
  return exp.paidBy ? { [exp.paidBy]: Math.round(exp.amount ?? 0) } : {};
}

export function rateOf(trip, cur) {
  if (!cur || cur === trip.base) return 1;
  const r = trip.rates?.[cur]?.rate;
  return r > 0 ? r : null;
}

// 外貨の分を基準通貨に換算するときも、合計が一致するよう比例配分で丸める
function scaleTo(map, baseTotal, keyPrefix) {
  const ids = Object.keys(map);
  const ints = allocate(baseTotal, ids.map((id) => map[id]), ids.map((id) => keyPrefix + id));
  const out = {};
  ids.forEach((id, i) => { if (ints[i]) out[id] = ints[i]; });
  return out;
}

/**
 * 1件を基準通貨に直した「払った額」「負担額」。
 * @returns {{ total:number, paid:Record<string,number>, shares:Record<string,number>, problem:string|null, detail }}
 */
export function expenseInBase(exp, trip, validIds) {
  const base = trip.base || 'JPY';
  if (exp.kind === 'transfer') {
    const amt = Math.round(exp.amount ?? 0);
    return { total: amt, paid: { [exp.from]: amt }, shares: { [exp.to]: amt }, problem: null, transfer: true };
  }
  const detail = computeShares(exp, validIds);
  const cur = exp.currency || base;
  const paid = paidMap(exp);
  const paidSum = sum(Object.values(paid));
  let problem = detail.problem;
  if (!problem && !Object.keys(paid).length) problem = '払った人を選んでください';
  if (!problem && paidSum !== Math.round(exp.amount ?? 0)) problem = '払った額の合計が支払額と合っていません';

  let total;
  if (cur === base) total = Math.round(exp.amount ?? 0);
  else if (exp.baseAmount > 0) total = Math.round(exp.baseAmount);
  else {
    const r = rateOf(trip, cur);
    total = r ? Math.round(((exp.amount ?? 0) / 10 ** decimalsOf(cur)) * r * 10 ** decimalsOf(base)) : null;
    if (total == null && !problem) problem = `${cur} のレートが未設定です`;
  }
  if (problem || total == null) return { total: total ?? 0, paid: {}, shares: {}, problem, detail };
  if (cur === base) return { total, paid, shares: detail.shares, problem: null, detail };
  return {
    total,
    paid: scaleTo(paid, total, (exp.id ?? '') + ':p:'),
    shares: scaleTo(detail.shares, total, (exp.id ?? '') + ':s:'),
    problem: null,
    detail,
  };
}

// money.js の decimals と同じ（循環 import を避けるため最小限だけ持つ）
const ZERO = new Set(['JPY', 'KRW', 'TWD', 'VND', 'IDR', 'CLP', 'ISK', 'HUF']);
function decimalsOf(cur) { return ZERO.has(cur) ? 0 : 2; }

/**
 * 旅行全体の集計。
 * @returns {{ members: Record<string,{paid:number, share:number, net:number}>, spent:number, count:number,
 *            problems: {id:string, problem:string}[], perExpense: Map<string, ReturnType<typeof expenseInBase>> }}
 */
export function computeBalances(trip, members, expenses) {
  const ids = members.map((m) => m.id);
  const res = { members: {}, spent: 0, count: 0, problems: [], perExpense: new Map() };
  for (const id of ids) res.members[id] = { paid: 0, share: 0, net: 0, transferIn: 0, transferOut: 0 };
  for (const exp of expenses) {
    if (exp.deleted) continue;
    const r = expenseInBase(exp, trip, ids);
    res.perExpense.set(exp.id, r);
    if (r.problem) { res.problems.push({ id: exp.id, problem: r.problem }); continue; }
    if (!r.transfer) { res.spent += r.total; res.count += 1; }
    for (const [id, v] of Object.entries(r.paid)) {
      if (!res.members[id]) continue;
      if (r.transfer) res.members[id].transferOut += v; else res.members[id].paid += v;
    }
    for (const [id, v] of Object.entries(r.shares)) {
      if (!res.members[id]) continue;
      if (r.transfer) res.members[id].transferIn += v; else res.members[id].share += v;
    }
  }
  for (const id of ids) {
    const m = res.members[id];
    m.net = m.paid + m.transferOut - m.share - m.transferIn;
  }
  return res;
}

// ---------------------------------------------------------------------
// 精算：純残高（+ は受け取る、− は払う）から送金リストを作る
// ---------------------------------------------------------------------

// 貪欲法：大きい借りから大きい貸しへ
function greedy(entries) {
  const debt = entries.filter((e) => e.amt < 0).map((e) => ({ id: e.id, amt: -e.amt })).sort((a, b) => b.amt - a.amt);
  const cred = entries.filter((e) => e.amt > 0).map((e) => ({ id: e.id, amt: e.amt })).sort((a, b) => b.amt - a.amt);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const pay = Math.min(debt[i].amt, cred[j].amt);
    if (pay > 0) out.push({ from: debt[i].id, to: cred[j].id, amount: pay });
    debt[i].amt -= pay;
    cred[j].amt -= pay;
    if (debt[i].amt === 0) i++;
    if (cred[j].amt === 0) j++;
  }
  return out;
}

// 送金回数が最少になる分け方。合計0になるグループにできるだけ多く分け、
// グループごとに貪欲法で送る（k人のグループは k−1 回で済む）。14人までは厳密解
function minimalTransfers(entries) {
  const k = entries.length;
  if (k <= 2 || k > 14) return greedy(entries);
  const N = 1 << k;
  const sums = new Float64Array(N);
  const dp = new Int8Array(N);
  for (let mask = 1; mask < N; mask++) {
    const low = mask & -mask;
    const i = 31 - Math.clz32(low);
    sums[mask] = sums[mask ^ low] + entries[i].amt;
  }
  for (let mask = 1; mask < N; mask++) {
    let best = 0;
    for (let i = 0; i < k; i++) if (mask & (1 << i)) { const v = dp[mask ^ (1 << i)]; if (v > best) best = v; }
    dp[mask] = best + (sums[mask] === 0 ? 1 : 0);
  }
  // 取り出した順を逆にたどると、合計0で区切れるグループの並びになる
  const seq = [];
  let mask = N - 1;
  while (mask) {
    const z = sums[mask] === 0 ? 1 : 0;
    for (let i = 0; i < k; i++) {
      if ((mask & (1 << i)) && dp[mask ^ (1 << i)] === dp[mask] - z) { seq.push(i); mask ^= 1 << i; break; }
    }
  }
  seq.reverse();
  const out = [];
  let group = [], acc = 0;
  for (const i of seq) {
    group.push(entries[i]);
    acc += entries[i].amt;
    if (acc === 0) { out.push(...greedy(group)); group = []; }
  }
  if (group.length) out.push(...greedy(group));
  return out;
}

/**
 * @param {Record<string, number>} nets 純残高（基準通貨の最小単位）
 * @param {{ unit?: number, hub?: string|null, order?: string[] }} opts
 *   unit: 端数をまとめる単位（1 / 10 / 100）。hub: 幹事にまとめる場合の人
 * @returns {{ transfers: {from:string, to:string, amount:number}[], adjust: Record<string, number> }}
 */
export function settle(nets, opts = {}) {
  const unit = opts.unit > 1 ? opts.unit : 1;
  const order = opts.order ?? Object.keys(nets);
  let ids = order.filter((id) => Math.round(nets[id] ?? 0) !== 0);
  let vals = ids.map((id) => Math.round(nets[id]));
  const adjust = {};
  if (unit > 1 && ids.length) {
    const r = roundToTotal(vals.map((v) => v / unit), 0, ids).map((v) => v * unit);
    ids.forEach((id, i) => { if (r[i] !== vals[i]) adjust[id] = r[i] - vals[i]; });
    vals = r;
  }
  const entries = ids.map((id, i) => ({ id, amt: vals[i] })).filter((e) => e.amt !== 0);

  if (opts.hub && order.includes(opts.hub)) {
    const hub = opts.hub;
    const transfers = [];
    for (const e of entries) {
      if (e.id === hub) continue;
      if (e.amt < 0) transfers.push({ from: e.id, to: hub, amount: -e.amt });
      else transfers.push({ from: hub, to: e.id, amount: e.amt });
    }
    return { transfers, adjust };
  }
  const transfers = minimalTransfers(entries);
  // 表示は「払う人」の並び順で
  const pos = new Map(order.map((id, i) => [id, i]));
  transfers.sort((a, b) => (pos.get(a.from) - pos.get(b.from)) || (pos.get(a.to) - pos.get(b.to)));
  return { transfers, adjust };
}
