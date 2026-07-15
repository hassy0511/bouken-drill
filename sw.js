/* ぼうけんドリル Service Worker
 * 方針（P0恒久対策）:
 *  - ナビゲーション（index.html）は network-first：常に最新を取りに行き、オフライン時のみキャッシュ
 *  - words.json も network-first（問題データの更新を即反映）
 *  - その他の静的資産は cache-first
 *  - 新SWは自動では有効化せず、ページからの SKIP_WAITING メッセージで切替
 *    （ページ側が「あたらしい ぼうけんが とどいたよ！」トーストを出し、タップでリロード）
 */
const CACHE = 'bouken-v10';
const ASSETS = ['./', './index.html', './manifest.json', './words.json', './icon-192.png', './icon-512.png'];
const NETWORK_FIRST = ['./words.json'];

self.addEventListener('install', e => {
  /* skipWaiting はここでは呼ばない（ユーザー操作で切り替えるため） */
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

const putCache = (req, res) => {
  const cp = res.clone();
  caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
  return res;
};

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isNav = e.request.mode === 'navigate' || url.pathname.endsWith('/index.html');
  const isNetFirst = NETWORK_FIRST.some(p => url.pathname.endsWith(p.slice(1)));

  if (isNav || isNetFirst) {
    /* network-first：最新を取得できたらキャッシュも更新。失敗時のみキャッシュへ */
    e.respondWith(
      fetch(e.request)
        .then(res => (res && res.ok) ? putCache(e.request, res) : caches.match(e.request).then(hit => hit || res))
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  /* cache-first：静的資産 */
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request)
      .then(res => putCache(e.request, res))
      .catch(() => caches.match('./index.html')))
  );
});
