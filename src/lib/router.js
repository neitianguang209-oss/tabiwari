import { React } from './html.js';

// ハッシュでの画面切り替え（GitHub Pages のサブパスでもそのまま動く）
function parse(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const seg = path.split('/').filter(Boolean);
  if (!seg.length) return { name: 'home', query };
  if (seg[0] === 'new') return { name: 'create', query };
  if (seg[0] === 'join') return { name: 'join', query };
  if (seg[0] === 't' && seg[1]) {
    const tripId = seg[1];
    if (seg[2] === 'e' && seg[3]) return { name: 'expense', tripId, expenseId: seg[3] === 'new' ? null : seg[3], query };
    if (seg[2] === 'm' && seg[3]) return { name: 'member', tripId, memberId: seg[3], query };
    const tab = ['settle', 'stats', 'settings'].includes(seg[2]) ? seg[2] : 'list';
    return { name: 'trip', tripId, tab, query };
  }
  return { name: 'home', query };
}

let depth = 0; // アプリ内で進んだ回数（戻るでアプリの外に出ないように）

export function useRoute() {
  const [hash, setHash] = React.useState(location.hash);
  React.useEffect(() => {
    const f = () => setHash(location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return React.useMemo(() => parse(hash), [hash]);
}

export function go(path, { replace = false } = {}) {
  const url = '#' + path;
  if (replace) {
    history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    depth++;
    location.hash = path;
  }
}

export function back(fallback = '/') {
  if (depth > 0) { depth--; history.back(); }
  else go(fallback, { replace: true });
}
