// IndexedDB の最小ラッパー（キー → 値）。
// localStorage は GitHub Pages の同じドメインの他アプリと容量を分け合うので、旅のデータはこちらに置く。
const DB_NAME = 'tabiwari';
const STORE = 'kv';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    const out = fn(st);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const idb = {
  get: (k) => tx('readonly', (st) => st.get(k)),
  set: (k, v) => tx('readwrite', (st) => st.put(v, k)),
  del: (k) => tx('readwrite', (st) => st.delete(k)),
  keys: () => tx('readonly', (st) => st.getAllKeys()),
};
