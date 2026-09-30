import { html, React } from '../lib/html.js';
import { Icon } from './icons.js';
import { Sheet, toast, copyText } from './components.js';
import { decimals, fmt, curInfo } from '../lib/money.js';
import { evaluate, pushKey, trimNum, pretty, OPS, KEYS } from '../lib/calc.js';

export { evaluate };

const { useState, useEffect, useCallback } = React;


/**
 * 電卓シート
 * - onApply がある：入力欄の電卓（結果を欄に入れる）
 * - onRecord がある：単体の電卓（結果で記録を始める）
 */
export function CalcSheet({ open, onClose, initial = '', cur = 'JPY', onApply, onRecord, title = '電卓' }) {
  const [expr, setExpr] = useState('');
  useEffect(() => { if (open) setExpr(initial ? String(initial) : ''); }, [open]);

  const press = useCallback((k) => setExpr((e) => pushKey(e, k)), []);

  // パソコンのキーボードでも打てるように
  useEffect(() => {
    if (!open) return;
    const map = { '*': '×', x: '×', '/': '÷', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Escape: null, Delete: 'AC', '.': '.' };
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); return; }
      if (e.key in map && map[e.key]) { e.preventDefault(); press(map[e.key]); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, press]);

  const value = evaluate(expr);
  const d = decimals(cur);
  const rounded = value == null ? null : Math.round(value * 10 ** d) / 10 ** d;
  const minor = rounded == null ? null : Math.round(rounded * 10 ** d);
  const wasRounded = value != null && Math.abs(value - rounded) > 1e-9;
  const hasOp = /[+−×÷]/.test(expr.replace(/^−/, ''));

  async function copy() {
    if (rounded == null) return;
    if (await copyText(String(rounded))) toast('コピーしました');
  }

  return html`<${Sheet} open=${open} onClose=${onClose} title=${title}>
    <div class="calc">
      <div class="calc-display" aria-live="polite">
        <div class="calc-expr">${expr ? pretty(expr) : '　'}</div>
        <div class="calc-result num">${value == null ? (expr ? '…' : '0') : `${hasOp ? '= ' : ''}${fmt(minor, cur)}`}</div>
        ${wasRounded ? html`<div class="tiny muted">${d ? '小数第2位で' : '小数点以下を'}四捨五入しています（${trimNum(value)}）</div>` : null}
      </div>
      <div class="calc-quick">
        <button type="button" onClick=${() => press('%tax10')}>＋税10%</button>
        <button type="button" onClick=${() => press('%tax8')}>＋税8%</button>
        <button type="button" onClick=${() => press('(')}>(</button>
        <button type="button" onClick=${() => press(')')}>)</button>
      </div>
      <div class="calc-keys">
        ${KEYS.flat().map((k) => {
          const cls = k === '=' ? 'eq' : OPS.includes(k) ? 'op' : ['AC', '⌫', '%'].includes(k) ? 'fn' : '';
          const aria = { '⌫': '1文字消す', AC: 'すべて消す', '%': 'パーセント（100で割る）' }[k] ?? k;
          return html`<button type="button" key=${k} class=${cls} aria-label=${aria} onClick=${() => press(k)}>${k}</button>`;
        })}
      </div>
      ${onApply ? html`<button type="button" class="btn primary block" disabled=${minor == null || minor <= 0}
          onClick=${() => { onApply(minor); onClose(); }}>
          <${Icon} name="check" />${minor != null && minor > 0 ? `${fmt(minor, cur)} を入れる` : '金額を計算してください'}
        </button>`
      : html`<div class="row">
          <button type="button" class="btn grow" disabled=${rounded == null} onClick=${copy}><${Icon} name="copy" />コピー</button>
          ${onRecord ? html`<button type="button" class="btn primary grow" disabled=${minor == null || minor <= 0}
            onClick=${() => { onRecord(rounded); onClose(); }}><${Icon} name="plus" />この金額で記録</button>` : null}
        </div>`}
      <div class="tiny faint" style=${{ textAlign: 'center', marginTop: '8px' }}>${curInfo(cur).name}で計算しています</div>
    </div>
  <//>`;
}

// 入力欄の横に置く小さな電卓ボタン
export function CalcButton({ onClick, label = '電卓で計算', big = false }) {
  return html`<button type="button" class=${'calc-btn' + (big ? ' big' : '')} aria-label=${label} title=${label} onClick=${onClick}>
    <${Icon} name="calc" size=${big ? 22 : 18} />
  </button>`;
}
