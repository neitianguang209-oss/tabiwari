import { html, React } from '../lib/html.js';
import { Icon } from './icons.js';
import { Sheet, Note, toast } from './components.js';
import { registerAiKey, findLocalGeminiKey } from './receipt.js';
import { flushAll } from '../lib/store.js';

const { useState } = React;

// AI読み取りの準備（Gemini の無料キーを1回だけ登録する。登録後は旅のメンバー全員が使える）
export function AiSetupSheet({ open, onClose, onReady, tripId }) {
  const localKey = findLocalGeminiKey();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function register(k) {
    setBusy(true);
    setErr('');
    try {
      await flushAll();
      const r = await registerAiKey(tripId, k.trim());
      if (r.ok) {
        toast('AI読み取りが使えるようになりました');
        setKey('');
        onReady?.();
      } else if (r.error === 'trip') {
        setErr('この旅がまだクラウドに保存されていません。電波のあるところで少し待ってから試してください。');
      } else if (r.error === 'format') {
        setErr('キーの形が違うようです。AI Studio の「キーをコピー」で丸ごと貼り付けてください。');
      } else {
        setErr('このキーは使えないようです。AI Studio でキーをコピーし直してください。');
      }
    } catch {
      setErr('通信できませんでした。電波のあるところで試してください。');
    } finally {
      setBusy(false);
    }
  }

  return html`<${Sheet} open=${open} onClose=${onClose} title="AI読み取りの準備">
    <div class="stack">
      <div class="muted small" style=${{ lineHeight: 1.8 }}>
        レシートの読み取りには Google の Gemini（無料枠）を使います。<b>最初に1回だけ</b>キーを登録すると、この旅のメンバー全員がキーなしで使えるようになります。
      </div>

      ${localKey ? html`<div class="card flat" style=${{ background: 'var(--sun-soft)' }}>
        <div class="bold" style=${{ marginBottom: '4px' }}>📚 読書記録アプリのキーが見つかりました</div>
        <div class="small muted" style=${{ marginBottom: '10px' }}>この端末の読書記録アプリに登録してある Gemini のキーをそのまま使えます。</div>
        <button class="btn primary block" disabled=${busy} onClick=${() => register(localKey)}>
          <${Icon} name="sparkle" />${busy ? '確認しています…' : 'このキーを使う'}
        </button>
      </div>` : null}

      <details open=${!localKey}>
        <summary class="small bold" style=${{ cursor: 'pointer', padding: '4px 0' }}>${localKey ? '別のキーを使う' : 'キーを登録する'}</summary>
        <ol class="small muted" style=${{ paddingLeft: '20px', lineHeight: 1.9, margin: '8px 0' }}>
          <li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> を開いて「APIキーを作成」</li>
          <li>できたキーをコピーして、下に貼り付け</li>
        </ol>
        <div class="row">
          <input class="input grow" type="password" autocomplete="off" placeholder="AIza…" value=${key} onInput=${(e) => setKey(e.target.value)} aria-label="Gemini の APIキー" />
          <button class="btn primary" disabled=${busy || key.trim().length < 20} onClick=${() => register(key)}>登録</button>
        </div>
      </details>

      ${err ? html`<${Note} kind="warn" icon="alert">${err}<//>` : null}

      <div class="tiny faint" style=${{ lineHeight: 1.7 }}>
        キーはサーバーだけに保存され、メンバーの画面には表示されません。
        Google 側で支払い方法を登録していない無料のキーなら、上限に達しても読み取りが止まるだけで料金はかかりません。
        1つの旅で1日60回まで読み取れます。
      </div>
    </div>
  <//>`;
}
