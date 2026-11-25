importScripts('config.js', 'reminder-core.js');
// Offline cache: app shell cache-first, Google Fonts at runtime.
const V = 'idee-v8';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'sync.js', 'push.js', 'config.js', 'reminder-core.js', 'vendor/lucide.min.js', 'manifest.webmanifest',
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

/* ---------- promemoria: dati locali ---------- */
function openDb() {
  return new Promise(res => {
    const r = indexedDB.open('idee-db');
    r.onupgradeneeded = () => { r.transaction.abort(); res(null); };
    r.onerror = () => res(null);
    r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains('ideas')) { db.close(); res(null); } else res(db); };
  });
}
async function readIdeas() {
  const db = await openDb(); if (!db) return [];
  return new Promise(res => {
    const q = db.transaction('ideas').objectStore('ideas').getAll();
    q.onsuccess = () => { db.close(); res(q.result || []); };
    q.onerror = () => { db.close(); res([]); };
  });
}
async function putIdeas(list) {
  if (!list.length) return;
  const db = await openDb(); if (!db) return;
  await new Promise(res => { const t = db.transaction('ideas', 'readwrite'); list.forEach(i => t.objectStore('ideas').put(i)); t.oncomplete = t.onerror = () => { db.close(); res(); }; });
}
async function readMeta(k) {
  const db = await openDb(); if (!db || !db.objectStoreNames.contains('meta')) return undefined;
  return new Promise(res => { const q = db.transaction('meta').objectStore('meta').get(k); q.onsuccess = () => { db.close(); res(q.result); }; q.onerror = () => { db.close(); res(undefined); }; });
}
// riallinea il server dopo un'azione dalla notifica (rimanda / fatto / ricorrente)
async function serverSync(ideas) {
  try {
    const cfg = self.IDEE_CONFIG || {}, device = await readMeta('device');
    const sub = await self.registration.pushManager.getSubscription();
    if (!cfg.pushServer || !device || !sub) return;
    await fetch(cfg.pushServer.replace(/\/$/, '') + '/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, sub: sub.toJSON(), reminders: RC.serverList(ideas) }) });
  } catch {}
}
async function tellClients(msg) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach(c => c.postMessage(msg));
  return list;
}

// Push dal server: arriva "vuoto", qui decido cosa mostrare leggendo la memoria del telefono.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const now = Date.now() + 90000; // tolleranza: il server invia fino a 30 s prima
    const ideas = await readIdeas();
    const fired = ideas.filter(i => RC.firing(i, now).length);
    fired.forEach(i => RC.fire(i, now));
    let show = fired;
    // già scattate con l'app aperta: le ripropongo (stesso tag, nessun doppione)
    if (!show.length) show = ideas.filter(i => i.remindPending || (RC.active(i) && !i.remindRepeat && i.remindAt <= now && i.remindAt > now - 15 * 60000));
    if (!show.length) return self.registration.showNotification('Idee', { body: 'Le notifiche dei promemoria sono attive ✓', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'idee-test' });
    await putIdeas(fired);
    for (const i of show) await self.registration.showNotification(RC.title(i), RC.notifOptions(i));
    if (fired.length) { await serverSync(ideas); await tellClients({ reload: true }); }
  })());
});

// tocco sulla notifica: pulsanti "Rimanda" / "Fatto", oppure apre l'idea
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data?.id;
  if (id && (e.action === 'snooze' || e.action === 'done')) {
    e.waitUntil((async () => {
      const ideas = await readIdeas();
      const i = ideas.find(x => x.id === id); if (!i) return;
      if (e.action === 'done') RC.done(i); else RC.snooze(i, RC.snoozeChoice().ts);
      await putIdeas([i]);
      await serverSync(ideas);
      await tellClients({ reload: true });
    })());
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list[0];
    if (c) { c.postMessage({ open: id }); return c.focus(); }
    return self.clients.openWindow('./?open=' + encodeURIComponent(id || ''));
  }));
});
