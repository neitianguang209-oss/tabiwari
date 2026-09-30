import { React } from '../lib/html.js';
import { subscribe, getVersion, getTrip, getMe, getSync, pendingCount } from '../lib/store.js';
import { computeBalances } from '../lib/split.js';

export function useStore() {
  return React.useSyncExternalStore(subscribe, getVersion);
}

// 旅1つ分のデータと集計（データが変わったときだけ計算し直す）
export function useTripData(tripId) {
  useStore();
  const snap = getTrip(tripId);
  const bal = React.useMemo(
    () => (snap?.trip ? computeBalances(snap.trip, snap.members, snap.expenses) : null),
    [snap],
  );
  return { snap, bal, me: getMe(tripId), sync: getSync(tripId), pending: pendingCount(tripId) };
}

export function useOnline() {
  const [on, setOn] = React.useState(navigator.onLine !== false);
  React.useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}
