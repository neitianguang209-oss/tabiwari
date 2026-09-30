// 電卓の計算（＋−×÷ と かっこ。eval は使わない）。画面に依存しない純粋な関数だけ
export const OPS = '+−×÷';
export function evaluate(expr) {
  let s = String(expr ?? '').replace(/,/g, '').trim();
  // 打っている途中の「12+」のような末尾の記号は無視して途中結果を出す
  while (s && (OPS.includes(s.at(-1)) || s.at(-1) === '(')) s = s.slice(0, -1);
  if (!s) return null;
  const tokens = s.match(/\d*\.?\d+\.?|[+−×÷()\-]/g);
  if (!tokens) return null;
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  function factor() {
    const t = take();
    if (t === '−' || t === '-') { const v = factor(); return v == null ? null : -v; }
    if (t === '(') {
      const v = sum();
      if (peek() === ')') take();
      return v;
    }
    const n = parseFloat(t);
    return isFinite(n) ? n : null;
  }
  function product() {
    let v = factor();
    while (v != null && (peek() === '×' || peek() === '÷')) {
      const op = take();
      const r = factor();
      if (r == null) return null;
      if (op === '÷' && r === 0) return null;
      v = op === '×' ? v * r : v / r;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (v != null && (peek() === '+' || peek() === '−' || peek() === '-')) {
      const op = take();
      const r = product();
      if (r == null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = sum();
  return v != null && isFinite(v) ? v : null;
}

export const KEYS = [
  ['AC', '⌫', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '00', '.', '='],
];

export function pushKey(expr, k) {
  const last = expr.at(-1) ?? '';
  const isOp = (c) => OPS.includes(c);
  if (k === 'AC') return '';
  if (k === '⌫') return expr.slice(0, -1);
  if (k === '=') {
    const v = evaluate(expr);
    return v == null ? expr : trimNum(v);
  }
  if (k === '%') {
    const v = evaluate(expr);
    return v == null ? expr : trimNum(v / 100);
  }
  if (k === '(') return isOp(last) || last === '(' || !expr ? expr + '(' : expr + '×(';
  if (k === ')') {
    const open = (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
    return open > 0 && !isOp(last) && last !== '(' ? expr + ')' : expr;
  }
  if (k === '%tax10' || k === '%tax8') {
    const v = evaluate(expr);
    if (v == null) return expr;
    const rate = k === '%tax10' ? '1.1' : '1.08';
    return /[+−×÷]/.test(expr.replace(/^−/, '')) ? `(${expr})×${rate}` : `${expr}×${rate}`;
  }
  if (isOp(k)) {
    if (!expr) return k === '−' ? '−' : expr;
    if (isOp(last)) return expr.slice(0, -1) + k; // 記号を押し直したら置き換え
    return expr + k;
  }
  if (k === '.') {
    const cur = expr.split(/[+−×÷()]/).pop();
    if (cur.includes('.')) return expr;
    return expr + (cur === '' ? '0.' : '.');
  }
  // 数字
  const cur = expr.split(/[+−×÷()]/).pop();
  if (cur === '0' && k !== '.') return expr.slice(0, -1) + (k === '00' ? '0' : k);
  if (cur === '' && k === '00') return expr + '0';
  if (cur.replace('.', '').length >= 12) return expr;
  return expr + k;
}

export function trimNum(v) {
  const r = Math.round(v * 1e6) / 1e6;
  return String(r).replace('-', '−');
}
export function pretty(expr) {
  // 表示用：数字に3桁区切り
  return expr.replace(/\d+(\.\d*)?/g, (m) => {
    const [a, b] = m.split('.');
    return Number(a).toLocaleString('ja-JP') + (b !== undefined ? '.' + b : '');
  });
}
