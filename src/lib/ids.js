const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

// 推測されにくいランダムID（旅行IDは16文字 ≒ 92ビット＝リンクを知らない人は開けない）
export function randomId(len = 16) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[buf[i] % ALPHA.length];
  return s;
}
export const newTripId = () => randomId(16);
export const newMemberId = () => 'm_' + randomId(10);
export const newExpenseId = () => 'e_' + randomId(12);
export const newLineId = () => 'l_' + randomId(8);

export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
