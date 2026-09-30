// レシート写真の受け渡し・縮小・AI読み取り
import { callFn } from '../lib/api.js';

// 旅の画面のカメラボタンで選んだ写真を、入力画面へ渡す
let pending = null;
export function setPendingReceipt(file) { pending = file; }
export function takePendingReceipt() { const f = pending; pending = null; return f; }

async function loadBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
}

// 長辺 maxSide px の JPEG にして base64 で返す（レシートの細い文字が読める大きさ）
export async function compressImage(file, maxSide = 1800, quality = 0.82) {
  const bmp = await loadBitmap(file);
  const w = bmp.width, h = bmp.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.round(w * s), ch = Math.round(h * s);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(bmp, 0, 0, cw, ch);
  bmp.close?.();
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  // 画面に出す小さな見本
  const t = Math.min(1, 240 / Math.max(cw, ch));
  const small = document.createElement('canvas');
  small.width = Math.round(cw * t);
  small.height = Math.round(ch * t);
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  return { base64: dataUrl.split(',')[1], thumb: small.toDataURL('image/jpeg', 0.7) };
}

let statusCache = null;
export async function aiStatus(force = false) {
  if (!force && statusCache && Date.now() - statusCache.at < 5 * 60e3) return statusCache.ai;
  try {
    const r = await callFn('status', {}, { timeout: 12000 });
    statusCache = { ai: !!r.ai, at: Date.now() };
    return statusCache.ai;
  } catch {
    return null; // わからない（オフラインなど）
  }
}
export function markAiReady() { statusCache = { ai: true, at: Date.now() }; }

export async function registerAiKey(tripId, key) {
  const r = await callFn('set-key', { trip: tripId, key }, { timeout: 30000 });
  if (r.ok) markAiReady();
  return r;
}

export async function readReceipt(tripId, base64, currencies) {
  return callFn('receipt', { trip: tripId, image: base64, mime: 'image/jpeg', currencies }, { timeout: 120000 });
}

// 読書記録アプリ（同じ github.io ドメイン）に登録済みの Gemini キーがあれば使える
export function findLocalGeminiKey() {
  try { return localStorage.getItem('reading-log-gemini-key') || ''; } catch { return ''; }
}

export const AI_ERRORS = {
  nokey: 'AI読み取りの準備がまだです',
  cap: '今日はこの旅の読み取り回数の上限（60回）に達しました。明日また使えます',
  quota: 'AIの無料枠を使い切りました。しばらくしてから試すか、手で入力してください',
  key: '登録されているAIのキーが使えなくなっています。設定から登録し直してください',
  unreadable: 'うまく読み取れませんでした。明るい場所で、レシート全体が写るように撮り直してください',
  invalid: 'うまく読み取れませんでした。撮り直すか、手で入力してください',
  nomodel: 'AIが混み合っています。少し待ってから試してください',
  server: 'AIが混み合っています。少し待ってから試してください',
  timeout: '時間がかかりすぎたので中止しました。もう一度試してください',
  network: '通信できませんでした。電波のあるところで試してください',
  trip: 'この旅がまだクラウドに保存されていません。電波のあるところで少し待ってから試してください',
  image: '写真を読み込めませんでした',
};
