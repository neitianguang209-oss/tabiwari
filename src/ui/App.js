import { html, React } from '../lib/html.js';
import { useRoute } from '../lib/router.js';
import { ToastHost, DialogHost } from './components.js';
import { Home, JoinPage } from './Home.js';
import { CreateTrip } from './CreateTrip.js';
import { TripPage } from './TripPage.js';
import { ExpenseEditor } from './ExpenseEditor.js';
import { MemberPage } from './MemberPage.js';

const scrollMemory = new Map();

export function App() {
  const route = useRoute();
  const key = location.hash;

  // 一覧 → 編集 → 一覧 と戻ったとき、元のスクロール位置に戻す
  const prevKey = React.useRef(key);
  React.useLayoutEffect(() => {
    if (prevKey.current !== key) {
      scrollMemory.set(prevKey.current, window.scrollY);
      prevKey.current = key;
      window.scrollTo(0, scrollMemory.get(key) ?? 0);
    }
  }, [key]);

  let page;
  switch (route.name) {
    case 'create': page = html`<${CreateTrip} />`; break;
    case 'join': page = html`<${JoinPage} query=${route.query} />`; break;
    case 'trip': page = html`<${TripPage} key=${route.tripId} tripId=${route.tripId} tab=${route.tab} query=${route.query} />`; break;
    case 'expense': page = html`<${ExpenseEditor} key=${route.tripId + (route.expenseId ?? 'new')} tripId=${route.tripId} expenseId=${route.expenseId} query=${route.query} />`; break;
    case 'member': page = html`<${MemberPage} tripId=${route.tripId} memberId=${route.memberId} />`; break;
    default: page = html`<${Home} />`;
  }
  return html`<div class="app">${page}<${ToastHost} /><${DialogHost} /></div>`;
}
