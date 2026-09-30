import { html, React } from '../lib/html.js';
import { go } from '../lib/router.js';
import { openTrip, closeTrip, setMe, saveMember, flushAll, pull } from '../lib/store.js';
import { shareUrl } from '../lib/report.js';
import { useTripData, useOnline } from './hooks.js';
import { Icon } from './icons.js';
import { Avatar, Sheet, Note, toast, copyText, lineShareUrl, fmtDate } from './components.js';
import { ExpenseList } from './ExpenseList.js';
import { Settle } from './Settle.js';
import { Stats } from './Stats.js';
import { Settings } from './Settings.js';
import { setPendingReceipt } from './receipt.js';
import { CalcSheet } from './Calculator.js';
import { defaultCurrency } from './ExpenseEditor.js';

const { useEffect, useState } = React;

export function SyncPill({ sync, pending, online, onClick }) {
  let cls = '', text = '保存済み';
  if (!online || sync.state === 'offline') { cls = 'offline'; text = pending ? `オフライン・${pending}件あとで送信` : 'オフライン'; }
  else if (sync.state === 'error') { cls = 'error'; text = '同期できません・再試行'; }
  else if (sync.state === 'syncing' || pending) { cls = 'syncing'; text = '同期中…'; }
  return html`<button class=${'sync-pill ' + cls} onClick=${onClick} title=${sync.error ?? ''}><span class="dot"></span>${text}</button>`;
}

export function TripPage({ tripId, tab, query }) {
  useEffect(() => { openTrip(tripId); return () => closeTrip(tripId); }, [tripId]);
  const { snap, bal, me, sync, pending } = useTripData(tripId);
  const online = useOnline();
  const [shareOpen, setShareOpen] = useState(query?.share === '1');
  const [calcOpen, setCalcOpen] = useState(false);
  const [whoSkipped, setWhoSkipped] = useState(() => { try { return sessionStorage.getItem('tabiwari:skipme:' + tripId) === '1'; } catch { return false; } });

  useEffect(() => {
    if (query?.share === '1') go('/t/' + tripId, { replace: true });
  }, []);

  if (!snap?.trip) {
    const nf = sync.state === 'notfound';
    const off = !online || sync.state === 'offline';
    return html`<div class="page">
      <div class="topbar"><button class="icon-btn" aria-label="ホーム" onClick=${() => go('/')}><${Icon} name="back" /></button><h1>たびわり</h1></div>
      <div class="empty">
        <div class="e">${nf ? '🔍' : off ? '📡' : '⏳'}</div>
        <div class="bold">${nf ? 'この旅は見つかりませんでした' : off ? 'オフラインです' : '旅を読み込んでいます…'}</div>
        <div class="small" style=${{ marginTop: '6px' }}>${nf ? 'リンクが途中で切れていないか確かめてください。' : off ? '電波のあるところでもう一度開いてください。' : ''}</div>
        ${nf || off ? html`<button class="btn" style=${{ marginTop: '16px' }} onClick=${() => go('/')}>ホームへ</button>` : null}
      </div>
    </div>`;
  }

  const trip = snap.trip;
  const needWho = !me && !whoSkipped;
  const tabs = [
    { id: 'list', label: '記録', icon: 'list', path: '' },
    { id: 'settle', label: '精算', icon: 'settle', path: '/settle' },
    { id: 'stats', label: 'まとめ', icon: 'chart', path: '/stats' },
    { id: 'settings', label: '設定', icon: 'settings', path: '/settings' },
  ];
  const dates = trip.start ? `${fmtDate(trip.start, { weekday: false })}${trip.end && trip.end !== trip.start ? '〜' + fmtDate(trip.end, { weekday: false }) : ''}` : '';

  let body;
  if (tab === 'settle') body = html`<${Settle} snap=${snap} bal=${bal} me=${me} />`;
  else if (tab === 'stats') body = html`<${Stats} snap=${snap} bal=${bal} me=${me} />`;
  else if (tab === 'settings') body = html`<${Settings} snap=${snap} bal=${bal} me=${me} onShare=${() => setShareOpen(true)} />`;
  else body = html`<${ExpenseList} snap=${snap} bal=${bal} me=${me} />`;

  function onReceipt(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setPendingReceipt(f);
    go(`/t/${tripId}/e/new?receipt=1`);
  }

  return html`<div class="page">
    <div class="topbar">
      <button class="icon-btn" aria-label="旅の一覧" onClick=${() => go('/')}><${Icon} name="back" /></button>
      <div class="grow" style=${{ minWidth: 0 }}>
        <div class="row" style=${{ gap: '6px' }}>
          <span style=${{ fontSize: '18px' }}>${trip.emoji || '🧳'}</span>
          <h1 class="ellipsis">${trip.name}</h1>
        </div>
        <div class="row" style=${{ gap: '8px' }}>
          ${dates ? html`<span class="tiny muted">${dates}</span>` : null}
          <${SyncPill} sync=${sync} pending=${pending} online=${online} onClick=${() => { flushAll(); pull(tripId); }} />
        </div>
      </div>
      <button class="icon-btn" aria-label="電卓" title="電卓" onClick=${() => setCalcOpen(true)}><${Icon} name="calc" /></button>
      <button class="icon-btn" aria-label="メンバーに共有" onClick=${() => setShareOpen(true)}><${Icon} name="share" /></button>
    </div>

    ${sync.restored ? html`<div style=${{ marginBottom: '12px' }}><${Note} kind="sun" icon="cloud">
      クラウドにこの旅の記録が見つからなかったので、この端末に残っていた記録から復元しました。
    <//></div>` : null}

    ${body}

    ${tab === 'list' || tab === 'settle' ? html`<div class="fab-wrap">
      <label class="fab secondary" aria-label="レシートを撮って記録">
        <input type="file" accept="image/*" hidden onChange=${onReceipt} />
        <${Icon} name="camera" />
      </label>
      <button class="fab" onClick=${() => go(`/t/${tripId}/e/new`)}><${Icon} name="plus" />記録</button>
    </div>` : null}

    <nav class="tabbar" aria-label="旅のメニュー"><div class="inner">
      ${tabs.map((t) => html`<a key=${t.id} href=${'#/t/' + tripId + t.path} class=${tab === t.id ? 'on' : ''}
        aria-current=${tab === t.id ? 'page' : undefined}
        onClick=${(e) => { e.preventDefault(); go('/t/' + tripId + t.path, { replace: true }); }}>
        <${Icon} name=${t.icon} />${t.label}</a>`)}
    </div></nav>

    <${WhoAmISheet} open=${needWho && !shareOpen} snap=${snap}
      onPick=${(id) => { setMe(tripId, id); toast('ようこそ！'); }}
      onSkip=${() => { try { sessionStorage.setItem('tabiwari:skipme:' + tripId, '1'); } catch { /* 無視 */ } setWhoSkipped(true); }} />
    <${ShareSheet} open=${shareOpen} onClose=${() => setShareOpen(false)} snap=${snap} />
    <${CalcSheet} open=${calcOpen} onClose=${() => setCalcOpen(false)} cur=${defaultCurrency(snap)}
      onRecord=${(v) => go(`/t/${tripId}/e/new?amount=${encodeURIComponent(v)}`)} />
  </div>`;
}

// はじめて開いた人に「あなたはどの人？」を聞く
export function WhoAmISheet({ open, snap, onPick, onSkip, title = 'あなたはどの人？' }) {
  const [name, setName] = useState('');
  function addSelf() {
    const n = name.trim();
    if (!n) return;
    const m = saveMember(snap.id, { name: n, color: snap.allMembers.length % 8 });
    onPick(m.id);
  }
  return html`<${Sheet} open=${open} onClose=${onSkip} title=${title}>
    <div class="stack">
      <div class="muted small">この端末で記録するときの「あなた」を選んでください。「あなたの負担」や「払った人」の初期値に使います。</div>
      <div class="chips">
        ${snap.members.map((m) => html`<button key=${m.id} class="chip" onClick=${() => onPick(m.id)}><${Avatar} m=${m} />${m.name}</button>`)}
      </div>
      <div class="divider"></div>
      <label class="label" for="selfname">リストにいない場合</label>
      <div class="row">
        <input id="selfname" class="input grow" placeholder="あなたの名前" value=${name} onInput=${(e) => setName(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !e.isComposing) addSelf(); }} />
        <button class="btn primary" disabled=${!name.trim()} onClick=${addSelf}>参加</button>
      </div>
      <button class="link-btn" style=${{ alignSelf: 'center' }} onClick=${onSkip}>見るだけにする</button>
    </div>
  <//>`;
}

function QrCode({ text }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    import('qrcode-generator').then((mod) => {
      const qrcode = mod.default ?? mod;
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      if (alive) setSvg(qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [text]);
  if (!svg) return null;
  return html`<div class="qr" aria-label="旅のリンクのQRコード" dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

export function ShareSheet({ open, onClose, snap }) {
  const url = shareUrl(snap.id);
  const [showQr, setShowQr] = useState(false);
  const msg = `${snap.trip.emoji ?? ''}${snap.trip.name} の立て替えは「たびわり」で記録するよ！\n払ったらここに入れてね👇\n${url}`;
  async function copy() {
    if (await copyText(url)) toast('リンクをコピーしました');
  }
  async function nativeShare() {
    try { await navigator.share({ title: snap.trip.name, text: msg }); } catch { /* キャンセル */ }
  }
  return html`<${Sheet} open=${open} onClose=${onClose} title="メンバーを招待">
    <div class="stack">
      <div class="muted small">このリンクをLINEで送るだけ。開いた人は名前を選べば、すぐに記録・閲覧できます（ログイン不要）。</div>
      <div class="row" style=${{ background: 'var(--surface-2)', borderRadius: '12px', padding: '10px 12px' }}>
        <${Icon} name="link" size=${18} />
        <span class="grow ellipsis small num">${url}</span>
      </div>
      <a class="btn sun block" href=${lineShareUrl(msg)} target="_blank" rel="noopener"><${Icon} name="chat" />LINEで送る</a>
      <div class="row">
        <button class="btn grow" onClick=${copy}><${Icon} name="copy" />コピー</button>
        ${navigator.share ? html`<button class="btn grow" onClick=${nativeShare}><${Icon} name="share" />ほかのアプリ</button>` : null}
        <button class="btn grow" aria-pressed=${showQr} onClick=${() => setShowQr(!showQr)}><${Icon} name="qr" />QR</button>
      </div>
      ${showQr ? html`<${QrCode} text=${url} />` : null}
      <div class="tiny faint">リンクを知っている人は誰でも見たり記録したりできます。関係ない人には送らないでください。</div>
    </div>
  <//>`;
}
