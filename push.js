/* Idee — notifiche push dei promemoria (anche ad app chiusa).
   Il server (server/worker.js su Cloudflare) conosce solo: id casuale del dispositivo, id idea, ora.
   Testo e titolo restano sul telefono: il service worker li legge al momento della notifica. */
'use strict';

const Push = {
  timer: null,
  get cfg() { return window.IDEE_CONFIG || {}; },
  get configured() { return !!(this.cfg.pushServer && this.cfg.vapidPublic); },
  get supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
  device() {
    let d = localStorage.getItem('idee-device');
    if (!d) { d = b64url(crypto.getRandomValues(new Uint8Array(32))); localStorage.setItem('idee-device', d); }
    return d;
  },
  key() {
    const s = this.cfg.vapidPublic.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(s + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
  },
  async sub(create) {
    const reg = await navigator.serviceWorker.ready;
    let s = await reg.pushManager.getSubscription();
    if (!s && create) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: this.key() });
    return s;
  },
  async state() {
    if (!this.supported) return 'unsupported';
    if (!this.configured) return 'unconfigured';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission !== 'granted') return 'off';
    return (await this.sub(false)) ? 'on' : 'off';
  },
  async call(path, body) {
    const r = await fetch(this.cfg.pushServer.replace(/\/$/, '') + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  },
  async enable(silent) {
    if (!this.supported || !this.configured) { if (!silent) toast(this.supported ? 'Notifiche non ancora attive in questa versione' : 'Su iPhone installa prima l’app sulla schermata Home'); return false; }
    try {
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') {
        if (!silent) toast('Notifiche non consentite: puoi attivarle dalle impostazioni del telefono');
        this.render(); return false;
      }
      await this.sub(true);
      await this.sync();
      if (!silent) toast('Notifiche attive');
      this.render(); return true;
    } catch (e) { console.error(e); if (!silent) toast('Attivazione non riuscita, riprova'); this.render(); return false; }
  },
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.sync().catch(() => {}), 1500); },
  async sync() {
    if ((await this.state()) !== 'on') return;
    const s = await this.sub(false);
    const reminders = S.ideas.filter(i => i.remindAt && !i.remindDone && i.remindAt > Date.now() - 60000).map(i => ({ idea: i.id, at: i.remindAt }));
    await this.call('/sync', { device: this.device(), sub: s.toJSON(), reminders });
    localStorage.setItem('idee-push-synced', String(Date.now()));
  },
  async test() {
    try {
      const s = await this.sub(false); if (!s) return this.enable();
      const r = await this.call('/test', { device: this.device(), sub: s.toJSON() });
      toast(r.ok ? 'Notifica di prova inviata: arriva tra pochi secondi' : 'Invio non riuscito (' + r.status + ')');
    } catch { toast('Server non raggiungibile, riprova'); }
  },
  async disable() {
    try { const s = await this.sub(false); await s?.unsubscribe(); await this.call('/forget', { device: this.device() }); } catch {}
    toast('Notifiche disattivate'); this.render();
  },
  async render() {
    const el = $('#pushPanel'); if (!el) return;
    const st = await this.state();
    const text = {
      on: 'Attive: i promemoria arrivano sul telefono anche con l’app chiusa.',
      off: 'Spente: i promemoria li vedi solo aprendo l’app.',
      denied: 'Bloccate dal telefono. Per attivarle: Impostazioni del telefono → App → Idee → Notifiche.',
      unsupported: 'Questo browser non le supporta. Su iPhone: installa l’app sulla schermata Home (iOS 16.4 o successivo) e aprila da lì.',
      unconfigured: 'In arrivo con il prossimo aggiornamento.',
    }[st];
    el.innerHTML = `<p class="hint">${text}</p><div class="row">${
      st === 'on' ? `<button class="btn" data-push="test"><i data-lucide="bell-ring"></i>Invia prova</button><button class="btn ghost" data-push="off">Disattiva</button>`
      : st === 'off' ? `<button class="btn primary" data-push="on"><i data-lucide="bell"></i>Attiva notifiche</button>` : ''}</div>`;
    icons();
  },
  init() {
    $('#pushPanel').onclick = e => { const b = e.target.closest('[data-push]'); if (b) ({ on: () => this.enable(), off: () => this.disable(), test: () => this.test() })[b.dataset.push](); };
    this.render();
    // riallinea il server all'apertura (es. promemoria cambiati da un altro telefono)
    setTimeout(() => this.schedule(), 2500);
  },
};
window.Push = Push;
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', () => Push.init()) : Push.init();
