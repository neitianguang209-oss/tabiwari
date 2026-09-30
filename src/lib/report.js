// 文章・ファイルの書き出し（LINE用の精算メッセージ、CSV、負担額の理由）
import { fmt, decimals } from './money.js';
import { settle, computeShares } from './split.js';
import { PUBLIC_URL } from '../config.js';

export function shareUrl(tripId) {
  const onPublic = location.hostname.endsWith('github.io');
  const baseUrl = onPublic ? location.origin + location.pathname : PUBLIC_URL;
  return baseUrl + '#/t/' + tripId;
}

export function settlementPlan(snap, bal) {
  const trip = snap.trip;
  const order = snap.members.map((m) => m.id);
  const nets = Object.fromEntries(order.map((id) => [id, bal.members[id]?.net ?? 0]));
  return settle(nets, { unit: trip.settle?.unit ?? 1, hub: trip.settle?.hub ?? null, order });
}

export function settlementText(snap, bal) {
  const trip = snap.trip;
  const base = trip.base || 'JPY';
  const name = (id) => snap.memberById.get(id)?.name ?? '?';
  const { transfers } = settlementPlan(snap, bal);
  const showTotals = !!trip.settle?.showTotals;
  const lines = [];
  lines.push(`【${trip.emoji ?? ''}${trip.name} の精算】`);
  if (showTotals) lines.push(`この旅の合計 ${fmt(bal.spent, base)}（${bal.count}件）`);
  lines.push('');
  if (!transfers.length) {
    lines.push('✅ 精算はすべて完了しています');
  } else {
    lines.push('▼ 送金してください');
    for (const t of transfers) lines.push(`${name(t.from)} → ${name(t.to)}　${fmt(t.amount, base)}`);
  }
  if (showTotals) {
    lines.push('');
    lines.push('▼ ひとりずつの利用額（立て替えた額）');
    for (const m of snap.members) {
      const b = bal.members[m.id];
      if (!b) continue;
      lines.push(`${m.name}　${fmt(b.share, base)}（立替 ${fmt(b.paid, base)}）`);
    }
  }
  if ((trip.settle?.unit ?? 1) > 1) {
    lines.push('');
    lines.push(`※ ${trip.settle.unit}円単位にまとめています`);
  }
  lines.push('');
  lines.push('くわしい内訳 👇');
  lines.push(shareUrl(snap.id));
  return lines.join('\n');
}

// Excel でそのまま開ける CSV（BOM付き）
export function toCsv(snap, bal) {
  const trip = snap.trip;
  const base = trip.base || 'JPY';
  const members = snap.members;
  const name = (id) => snap.memberById.get(id)?.name ?? '';
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const modeLabel = { equal: '均等', items: '内訳', exact: '一人ずつ' };
  const head = ['日付', '項目', '種類', '通貨', '金額', base === 'JPY' ? '円換算' : `${base}換算`, '払った人', '分け方', ...members.map((m) => m.name + 'の負担'), 'メモ'];
  const rows = [head];
  const exps = snap.expenses.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const x of exps) {
    const r = bal.perExpense.get(x.id);
    if (x.kind === 'transfer') {
      rows.push([x.date, `精算 ${name(x.from)}→${name(x.to)}`, '送金', base, x.amount, x.amount, name(x.from), '', ...members.map(() => ''), x.memo ?? '']);
      continue;
    }
    const payers = Object.keys(r?.paid ?? {}).map(name).join('・');
    rows.push([
      x.date, x.title, CAT_LABEL[x.category] ?? '', x.currency || base, x.amount / 10 ** decimals(x.currency || base),
      r?.total ?? '', payers, x.split?.weights && x.split?.mode === 'equal' ? '比率' : modeLabel[x.split?.mode] ?? '',
      ...members.map((m) => r?.shares?.[m.id] ?? ''), x.memo ?? '',
    ]);
  }
  rows.push([]);
  rows.push(['', '合計', '', '', '', bal.spent, '', '', ...members.map((m) => bal.members[m.id]?.share ?? 0)]);
  rows.push(['', '立て替えた額', '', '', '', '', '', '', ...members.map((m) => bal.members[m.id]?.paid ?? 0)]);
  rows.push(['', '差額（＋受け取る／−払う）', '', '', '', '', '', '', ...members.map((m) => bal.members[m.id]?.net ?? 0)]);
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

export function downloadFile(name, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const FRAC = { 2: '½', 3: '⅓', 4: '¼', 5: '⅕', 6: '⅙' };
const CAT_LABEL = { food: '食事', move: '交通', stay: '宿泊', shop: '買い物', fun: '観光・遊び', other: 'その他' };

// この人の負担額がどうやって決まったかを短い文にする
export function explainShare(x, memberId, snap) {
  const split = x.split ?? {};
  const n = (split.members ?? []).length;
  const w = split.weights ? Number(split.weights[memberId] ?? 1) : null;
  const inP = (split.members ?? []).includes(memberId);
  const wTxt = w != null && inP ? `（×${w}）` : '';
  if (split.mode === 'items') {
    const parts = [];
    for (const l of split.lines ?? []) {
      const ms = l.members ?? [];
      if (ms.includes(memberId)) parts.push((l.name || '品目') + (ms.length > 1 ? (FRAC[ms.length] ?? `1/${ms.length}`) : ''));
    }
    const hasShared = (split.lines ?? []).some((l) => !(l.members ?? []).length);
    const d = computeShares(x, snap.members.map((m) => m.id));
    if ((hasShared || (d.rest > 0 && split.rest !== 'prop')) && inP) parts.push('みんなの分' + wTxt);
    if (d.rest > 0 && split.rest === 'prop' && d.shares[memberId]) parts.push('税など（比例）');
    if (d.rest < 0) parts.push('割引');
    return parts.length ? parts.join('・') : '—';
  }
  if (split.mode === 'exact') {
    const own = split.exact?.[memberId];
    const d = computeShares(x, snap.members.map((m) => m.id));
    const base = own ? `自分の分 ${fmt(own, x.currency || snap.trip.base)}` : '';
    const rest = d.rest && inP ? '残りを' + (split.rest === 'prop' ? '比例' : '均等') : '';
    return [base, rest].filter(Boolean).join('＋') || '—';
  }
  return split.weights ? `${n}人で比率割り${wTxt}` : `${n}人で均等`;
}
