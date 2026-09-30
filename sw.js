// たびわり Service Worker（オフラインでもアプリを開けるように）
// アプリを更新して公開するたびに CACHE_NAME の番号を上げること（上げないと古い画面が出続ける）
const CACHE_NAME = 'tabiwari-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/main.js',
  './src/config.js',
  './src/lib/api.js',
  './src/lib/html.js',
  './src/lib/idb.js',
  './src/lib/ids.js',
  './src/lib/money.js',
  './src/lib/report.js',
  './src/lib/router.js',
  './src/lib/split.js',
  './src/lib/store.js',
  './src/ui/AiSetup.js',
  './src/ui/Calculator.js',
  './src/lib/calc.js',
  './src/ui/App.js',
  './src/ui/components.js',
  './src/ui/CreateTrip.js',
  './src/ui/ExpenseEditor.js',
  './src/ui/ExpenseList.js',
  './src/ui/Home.js',
  './src/ui/hooks.js',
  './src/ui/icons.js',
  './src/ui/MemberPage.js',
  './src/ui/receipt.js',
  './src/ui/Settings.js',
  './src/ui/Settle.js',
  './src/ui/Stats.js',
  './src/ui/TripPage.js',
].map((p) => new URL(p, self.registration.scope).toString());

const INDEX_URL = new URL('./index.html', self.registration.scope).toString();
// 自分のファイルと、ライブラリ(esm.sh)・フォントだけキャッシュする。為替やDBの通信は素通し
const CACHEABLE_HOSTS = ['esm.sh', 'fonts.gstatic.com', 'fonts.googleapis.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_HOSTS.includes(url.hostname)) return;
  if (sameOrigin && !url.href.startsWith(self.registration.scope)) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: sameOrigin }).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') return caches.match(INDEX_URL);
          return cached;
        });
      return cached || fetchPromise;
    }),
  );
});
