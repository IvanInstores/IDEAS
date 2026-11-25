// Offline cache: app shell cache-first, Google Fonts at runtime.
const V = 'idee-v6';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'sync.js', 'push.js', 'config.js', 'vendor/lucide.min.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  const isFont = url.host.endsWith('fonts.googleapis.com') || url.host.endsWith('fonts.gstatic.com');
  if (url.origin !== location.origin && !isFont) return;
  // network-first for the page itself so updates arrive; cache-first for the rest
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => { caches.open(V).then(c => c.put('index.html', res.clone())); return res; })
      .catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r).then(res => {
    if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
    return res;
  })));
});

// tap on a reminder notification -> open that idea
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data?.id;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list[0];
    if (c) { c.postMessage({ open: id }); return c.focus(); }
    return self.clients.openWindow('./?open=' + encodeURIComponent(id || ''));
  }));
});

// Push dal server promemoria: arriva "vuoto", qui leggo le idee scadute dalla memoria del telefono.
function readIdeas() {
  return new Promise(res => {
    const r = indexedDB.open('idee-db');
    r.onupgradeneeded = () => { r.transaction.abort(); res([]); };
    r.onerror = () => res([]);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('ideas')) { db.close(); return res([]); }
      const q = db.transaction('ideas').objectStore('ideas').getAll();
      q.onsuccess = () => { db.close(); res(q.result || []); };
      q.onerror = () => { db.close(); res([]); };
    };
  });
}
function markNotified(ids) {
  return new Promise(res => {
    const r = indexedDB.open('idee-db');
    r.onerror = () => res();
    r.onsuccess = () => {
      const db = r.result, t = db.transaction('ideas', 'readwrite'), st = t.objectStore('ideas');
      ids.forEach(id => { const g = st.get(id); g.onsuccess = () => { if (g.result) { g.result.remindNotified = true; st.put(g.result); } }; });
      t.oncomplete = t.onerror = () => { db.close(); res(); };
    };
  });
}
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const now = Date.now();
    const all = (await readIdeas()).filter(i => i.remindAt && !i.remindDone && i.remindAt <= now + 90000);
    let due = all.filter(i => !i.remindNotified);
    // già notificate dall'app aperta: le ripropongo (stesso tag, nessun doppione)
    if (!due.length) due = all.filter(i => i.remindAt > now - 15 * 60000);
    const opts = { icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [120, 60, 120] };
    if (!due.length) return self.registration.showNotification('Idee', { ...opts, body: 'Le notifiche dei promemoria sono attive ✓', tag: 'idee-test' });
    await markNotified(due.map(i => i.id));
    for (const i of due) {
      const title = i.title || (i.text || '').trim().split('\n')[0].slice(0, 80) || 'Idea';
      await self.registration.showNotification('💡 ' + title, { ...opts, body: 'È il momento di riprendere questa idea', tag: i.id, data: { id: i.id } });
    }
  })());
});
