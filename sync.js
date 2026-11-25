/* Idee — sincronizzazione cloud.
   Provider attivo: Dropbox (OAuth PKCE, nessun server). OneDrive e Google Drive: struttura pronta, da attivare.
   Struttura nella cartella scelta (default "/09 - IDEE"):
     Elenco idee.md          → elenco leggibile da PC
     Allegati/…              → foto, video, audio, disegni con nomi leggibili
     _app/idee.json          → dati per l'app (non modificare a mano)
*/
'use strict';

const CONFIG = window.IDEE_CONFIG || {};
const REDIRECT = location.origin + location.pathname;

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const asciiJson = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
const safeName = t => (t || '').replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);

/* ---------------- Dropbox ---------------- */
const Dropbox = {
  id: 'dropbox',
  label: 'Dropbox',
  appKey() { return CONFIG.dropboxAppKey || ''; },
  async connect() {
    const key = this.appKey();
    if (!key) throw new Error('nokey');
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
    localStorage.setItem('idee-oauth', JSON.stringify({ verifier, state, provider: 'dropbox', reconnect: !!Sync.cfg?.folder }));
    const u = new URL('https://www.dropbox.com/oauth2/authorize');
    Object.entries({ client_id: key, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
      token_access_type: 'offline', redirect_uri: REDIRECT, state }).forEach(([k, v]) => u.searchParams.set(k, v));
    location.href = u.toString();
  },
  async finish(code, pending) {
    const body = new URLSearchParams({ code, grant_type: 'authorization_code', code_verifier: pending.verifier, client_id: this.appKey(), redirect_uri: REDIRECT });
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body });
    if (!r.ok) throw new Error('token ' + r.status);
    const t = await r.json();
    return { refresh: t.refresh_token, access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000, account: t.account_id };
  },
  async token(auth) {
    if (auth.access && auth.exp > Date.now()) return auth.access;
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: this.appKey() });
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body });
    if (r.status === 400 || r.status === 401) throw new Error('auth');
    if (!r.ok) throw new Error('token ' + r.status);
    const t = await r.json();
    auth.access = t.access_token; auth.exp = Date.now() + (t.expires_in - 60) * 1000;
    await Sync.saveAuth();
    return auth.access;
  },
  async rpc(auth, ep, arg) {
    const r = await fetch('https://api.dropboxapi.com/2/' + ep, { method: 'POST',
      headers: { Authorization: 'Bearer ' + await this.token(auth), 'Content-Type': 'application/json' }, body: JSON.stringify(arg) });
    if (r.status === 409) return null;
    if (r.status === 401) throw new Error('auth');
    if (!r.ok) throw new Error(ep + ' ' + r.status);
    return r.json();
  },
  async upload(auth, path, blob) {
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST',
      headers: { Authorization: 'Bearer ' + await this.token(auth), 'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': asciiJson({ path, mode: 'overwrite', mute: true, autorename: false }) }, body: blob });
    if (r.status === 401) throw new Error('auth');
    if (!r.ok) throw new Error('upload ' + r.status);
    return r.json();
  },
  async download(auth, path) {
    const r = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST',
      headers: { Authorization: 'Bearer ' + await this.token(auth), 'Dropbox-API-Arg': asciiJson({ path }) } });
    if (r.status === 409) return null;
    if (r.status === 401) throw new Error('auth');
    if (!r.ok) throw new Error('download ' + r.status);
    return r.blob();
  },
  remove(auth, path) { return this.rpc(auth, 'files/delete_v2', { path }); },
  async folders(auth) {
    let r = await this.rpc(auth, 'files/list_folder', { path: '', recursive: false, limit: 500 });
    const out = [];
    while (r) {
      out.push(...r.entries.filter(e => e['.tag'] === 'folder').map(e => e.path_display));
      r = r.has_more ? await this.rpc(auth, 'files/list_folder/continue', { cursor: r.cursor }) : null;
    }
    return out.sort((a, b) => a.localeCompare(b, 'it'));
  },
  async mkdir(auth, path) { await this.rpc(auth, 'files/create_folder_v2', { path, autorename: false }); },
  async revoke(auth) { try { await fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + await this.token(auth) } }); } catch {} },
};

// Provider pronti a essere attivati: servono le registrazioni app (Microsoft Entra / Google Cloud).
const PLANNED = [
  { id: 'onedrive', label: 'OneDrive', note: 'In arrivo' },
  { id: 'gdrive', label: 'Google Drive', note: 'In arrivo' },
];
const PROVIDERS = { dropbox: Dropbox };

/* ---------------- motore di sync ---------------- */
const Sync = {
  cfg: null,          // { provider, folder, auth, lastSync, lastError }
  tomb: null,         // { ideas: {id: ts}, cats: {id: ts}, files: [paths da cancellare] }
  busy: false, timer: null, lastAuto: 0,

  get p() { return this.cfg && PROVIDERS[this.cfg.provider]; },
  get on() { return !!(this.cfg?.auth?.refresh && this.p && this.cfg.folder); },
  async saveAuth() { await DB.setMeta('sync', this.cfg); },
  async saveTomb() { await DB.setMeta('tomb', this.tomb); },

  async init() {
    this.cfg = (await DB.getMeta('sync')) || { provider: 'dropbox', folder: null };
    this.tomb = (await DB.getMeta('tomb')) || { ideas: {}, cats: {}, files: [] };
    await this.handleRedirect();
    this.render();
    if (this.on) setTimeout(() => this.run('auto'), 1500);
    addEventListener('online', () => this.schedule(500));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - this.lastAuto > 60000) this.schedule(800);
    });
  },
  async handleRedirect() {
    const q = new URLSearchParams(location.search);
    const code = q.get('code'), state = q.get('state'), err = q.get('error');
    if (!code && !err) return;
    history.replaceState(null, '', REDIRECT);
    const pending = JSON.parse(localStorage.getItem('idee-oauth') || 'null');
    localStorage.removeItem('idee-oauth');
    if (err || !pending || pending.state !== state) { toast('Collegamento annullato'); return; }
    try {
      this.cfg.provider = pending.provider;
      this.cfg.auth = await PROVIDERS[pending.provider].finish(code, pending);
      this.cfg.lastError = null;
      if (!pending.reconnect) this.cfg.folder = null;
      await this.saveAuth();
      if (pending.reconnect && this.cfg.folder) { toast(PROVIDERS[pending.provider].label + ' ricollegato'); setTimeout(() => this.run('manual'), 400); }
      else Wizard.open('folder');
    } catch (e) { console.error(e); Wizard.open('error'); }
  },

  schedule(ms = 3000) {
    if (!this.on) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run('auto'), ms);
  },
  tombstone(id, files) { this.tomb.ideas[id] = Date.now(); this.tomb.files.push(...files); this.saveTomb(); this.schedule(); },
  tombstoneCat(id) { this.tomb.cats[id] = Date.now(); this.saveTomb(); this.schedule(); },
  forget(files) { this.tomb.files.push(...files); this.saveTomb(); },

  path(rel) { return (this.cfg.folder.replace(/\/+$/, '') + '/' + rel).replace(/\/+/g, '/'); },

  async run(mode) {
    if (!this.on || this.busy) return;
    if (!navigator.onLine) { if (mode === 'manual') toast('Sei offline: sincronizzo appena torna la rete'); return; }
    this.busy = true; this.lastAuto = Date.now(); this.render('Sincronizzo…');
    const p = this.p, auth = this.cfg.auth;
    try {
      // 1. leggi lo stato remoto
      const rb = await p.download(auth, this.path('_app/idee.json'));
      const remote = rb ? JSON.parse(await rb.text()) : { cats: [], ideas: [], deleted: {}, deletedCats: {} };

      // 2. unisci cancellazioni
      const delI = { ...remote.deleted, ...this.tomb.ideas }, delC = { ...remote.deletedCats, ...this.tomb.cats };

      // 3. categorie: vince la più recente
      const cats = new Map();
      for (const c of [...remote.cats, ...S.cats]) {
        if (delC[c.id]) continue;
        const o = cats.get(c.id);
        if (!o || (c.updatedAt || c.createdAt || 0) >= (o.updatedAt || o.createdAt || 0)) cats.set(c.id, c);
      }
      const localCatIds = new Set(S.cats.map(c => c.id));
      S.cats = [...cats.values()];
      for (const id of localCatIds) if (!cats.has(id)) await DB.del('cats', id);
      await DB.putMany('cats', S.cats);

      // 4. idee: vince la più recente; scarica gli allegati che mancano
      let pulled = 0;
      for (const id of Object.keys(delI)) if (S.ideas.some(i => i.id === id)) { await DB.del('ideas', id); S.ideas = S.ideas.filter(i => i.id !== id); }
      for (const r of remote.ideas) {
        if (delI[r.id]) continue;
        const l = S.ideas.find(i => i.id === r.id);
        if (l && (l.updatedAt || 0) >= (r.updatedAt || 0)) continue;
        const blocks = [];
        for (const b of r.blocks) {
          const have = l?.blocks.find(x => x.id === b.id);
          const blob = have?.blob || (b.remotePath && await p.download(auth, b.remotePath));
          if (blob) blocks.push({ ...b, blob });
        }
        const idea = normalizeIdea({ ...r, blocks });
        await DB.put('ideas', idea);
        S.ideas = S.ideas.filter(i => i.id !== r.id).concat(idea); pulled++;
      }

      // 5. carica gli allegati nuovi
      let pushed = 0;
      for (const i of S.ideas) {
        let changed = false;
        for (const [n, b] of i.blocks.entries()) {
          if (b.remotePath) continue;
          const d = new Date(i.createdAt), pad = x => String(x).padStart(2, '0');
          const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
          const name = `${stamp} ${safeName(i.title || firstLine(i.text) || mediaTitle(i))} ${n + 1}-${b.id.slice(-4)}.${ext(b.mime || b.blob.type)}`;
          const rp = this.path('Allegati/' + name);
          await p.upload(auth, rp, b.blob);
          b.remotePath = rp; changed = true; pushed++;
          this.render(`Carico allegati… ${pushed}`);
        }
        if (changed) await DB.put('ideas', i);
      }

      // 6. cancella i file remoti non più usati
      const files = [...new Set(this.tomb.files)];
      for (const f of files) await p.remove(auth, f);
      this.tomb.files = [];

      // 7. scrivi dati + elenco leggibile
      const data = {
        app: 'idee', version: 2, updatedAt: Date.now(), cats: S.cats,
        ideas: S.ideas.map(i => ({ ...i, blocks: i.blocks.map(({ blob, ...b }) => b) })),
        deleted: delI, deletedCats: delC,
      };
      await p.upload(auth, this.path('_app/idee.json'), new Blob([JSON.stringify(data)], { type: 'application/json' }));
      await p.upload(auth, this.path('Elenco idee.md'), new Blob([this.markdown()], { type: 'text/markdown' }));

      this.tomb.ideas = {}; this.tomb.cats = {}; await this.saveTomb();
      this.cfg.lastSync = Date.now(); this.cfg.lastError = null; this.cfg.authExpired = false; await this.saveAuth();
      renderList();
      if (mode === 'manual' || pulled) toast(`Sincronizzato${pulled ? ` · ${pulled} idee ricevute` : ''}${pushed ? ` · ${pushed} allegati caricati` : ''}`);
    } catch (e) {
      console.error(e);
      this.cfg.lastError = e.message === 'auth' ? 'Accesso scaduto: ricollega ' + p.label : 'Ultimo tentativo non riuscito (' + e.message + ')';
      if (e.message === 'auth') this.cfg.authExpired = true;
      await this.saveAuth();
      if (mode === 'manual') toast(this.cfg.lastError);
    } finally { this.busy = false; this.render(); }
  },

  markdown() {
    const lines = ['# Idee', '', `Aggiornato: ${fmtFull(Date.now())} · ${S.ideas.length} idee`, '',
      '_File generato dall’app Idee: non modificarlo a mano, viene riscritto a ogni sincronizzazione._', ''];
    const groups = [[null, 'Senza categoria'], ...flatTree().map(({ c }) => [c.id, catPath(c.id)])];
    for (const [cid, name] of groups) {
      const list = S.ideas.filter(i => (i.catId || null) === cid).sort((a, b) => b.createdAt - a.createdAt);
      if (!list.length) continue;
      lines.push(`## ${name}`, '');
      for (const i of list) {
        const st = statusOf(i.status).label;
        lines.push(`### ${i.title || firstLine(i.text) || mediaTitle(i)}`);
        lines.push(`- **Creata:** ${fmtFull(i.createdAt)} · **Stato:** ${st}${i.remindAt && !i.remindDone ? ` · **Promemoria:** ${fmtFull(i.remindAt)}` : ''}`);
        if (i.text) lines.push('', ...(i.title ? i.text : i.text.split('\n').slice(1).join('\n')).split('\n').filter(Boolean).map(t => '> ' + t));
        const att = i.blocks.filter(b => b.remotePath).map(b => b.remotePath.split('/').pop());
        if (att.length) lines.push('', '- **Allegati (cartella Allegati):** ' + att.join(', '));
        lines.push('');
      }
    }
    return lines.join('\n');
  },

  connect() { Wizard.open('provider'); },
  async disconnect() {
    const r = await ask({ title: 'Scollegare ' + this.p.label + '?', input: false, okText: 'Scollega',
      msg: 'Le idee restano sul telefono e i file restano nel cloud. La sincronizzazione si ferma.' });
    if (!r) return;
    await this.p.revoke(this.cfg.auth);
    this.cfg.auth = null; this.cfg.lastSync = null; this.cfg.folder = null; await this.saveAuth(); this.render();
    toast('Scollegato');
  },

  render(busyText) {
    const el = $('#syncPanel'); if (!el) return;
    const head = $('#syncHead');
    if (head) {
      head.hidden = !this.on;
      head.classList.toggle('spin', !!busyText);
      head.classList.toggle('err', !!this.cfg?.lastError && !busyText);
      head.setAttribute('aria-label', busyText || (this.cfg?.lastError ? 'Sincronizzazione: errore' : 'Sincronizza ora'));
    }
    const rows = Object.values(PROVIDERS).map(p => {
      const active = this.on && this.cfg.provider === p.id;
      const status = busyText && active ? busyText
        : active ? (this.cfg.lastError || (this.cfg.lastSync ? 'Ultima sincronizzazione: ' + fmtFull(this.cfg.lastSync) : 'Collegato'))
        : this.on ? 'Disattivato: è attivo ' + this.p.label : 'Non collegato';
      return `<div class="prov ${active ? 'active' : ''}">
        <div class="prov-head"><i data-lucide="${active ? 'cloud-upload' : 'cloud'}"></i><b>${p.label}</b>
          ${active ? `<span class="pill ok">Attivo</span>` : ''}</div>
        <p class="hint">${esc(status)}${active ? `<br>Cartella: <b>${esc(this.cfg.folder)}</b>` : ''}</p>
        <div class="row">${active
          ? (this.cfg.authExpired
              ? `<button class="btn primary" data-sync="relogin"><i data-lucide="log-in"></i>Accedi di nuovo</button>`
              : `<button class="btn" data-sync="now"><i data-lucide="refresh-cw"></i>Sincronizza ora</button>`) +
            `<button class="btn ghost" data-sync="off">Scollega</button>`
          : this.on ? '' : `<button class="btn primary" data-sync="connect" data-p="${p.id}"><i data-lucide="link"></i>Collega ${p.label}</button>`}
        </div></div>`;
    }).join('') + PLANNED.map(p => `<div class="prov off">
        <div class="prov-head"><i data-lucide="cloud-off"></i><b>${p.label}</b><span class="pill">Da attivare</span></div>
        <p class="hint">${esc(p.note)}</p></div>`).join('');
    el.innerHTML = rows;
    icons();
  },
  bind() {
    $('#syncPanel').onclick = e => {
      const b = e.target.closest('[data-sync]'); if (!b) return;
      ({ now: () => this.run('manual'), off: () => this.disconnect(), connect: () => this.connect(),
         relogin: () => this.p.connect().catch(() => toast('Collegamento non disponibile')) })[b.dataset.sync]();
    };
    $('#syncHead').onclick = () => this.run('manual');
  },
};
/* ---------------- collegamento guidato ---------------- */
const Wizard = {
  open(step, extra) {
    if (!$('#settings').hidden) closeSheet('settings');
    openSheet('wizard'); this.show(step, extra);
  },
  close() { closeSheet('wizard'); Sync.render(); },
  steps: ['provider', 'login', 'folder', 'done'],
  show(step, extra) {
    const n = this.steps.indexOf(step);
    $('#wizDots').innerHTML = this.steps.map((_, k) => `<span class="${k <= n ? 'on' : ''}"></span>`).join('');
    const body = $('#wizBody');
    const p = Dropbox;
    if (step === 'provider') {
      body.innerHTML = `<h2>Dove salvo le tue idee?</h2>
        <p class="lead">Scegli il cloud: idee e allegati verranno copiati lì in automatico, così non li perdi e li ritrovi su altri telefoni.</p>
        <button class="wiz-opt" data-go="login"><i data-lucide="box"></i><span><b>Dropbox</b><small>Pronto</small></span><i data-lucide="chevron-right"></i></button>
        ${PLANNED.map(x => `<div class="wiz-opt off"><i data-lucide="cloud"></i><span><b>${x.label}</b><small>${x.note}</small></span></div>`).join('')}`;
    }
    if (step === 'login') {
      const ok = !!p.appKey();
      body.innerHTML = `<h2>Accedi a Dropbox</h2>
        <ol class="wiz-list">
          <li>Tocca <b>Accedi a Dropbox</b>: si apre la pagina di Dropbox.</li>
          <li>Entra con il tuo account (se non sei già dentro).</li>
          <li>Tocca <b>Consenti</b>. L’app userà solo la cartella che scegli al passo successivo.</li>
          <li>Tornerai qui da solo per scegliere la cartella.</li>
        </ol>
        ${ok ? `<button class="btn primary wide" data-go="auth"><i data-lucide="log-in"></i>Accedi a Dropbox</button>`
             : `<p class="wiz-warn"><i data-lucide="triangle-alert"></i>Il collegamento a Dropbox non è ancora attivo in questa versione dell’app. Riprova dopo il prossimo aggiornamento.</p>`}
        <button class="btn ghost wide" data-go="provider">Indietro</button>`;
    }
    if (step === 'folder') {
      body.innerHTML = `<h2>Scegli la cartella</h2>
        <p class="lead">Le idee verranno salvate in questa cartella del tuo Dropbox.</p>
        <div id="wizFolders" class="wiz-folders"><p class="hint">Carico le cartelle…</p></div>
        <div class="wiz-new">
          <input id="wizNew" placeholder="Nome nuova cartella" value="Idee" maxlength="60">
          <button class="btn" data-go="mkdir"><i data-lucide="folder-plus"></i>Crea</button>
        </div>`;
      p.folders(Sync.cfg.auth).then(list => {
        const box = $('#wizFolders');
        box.innerHTML = list.length ? list.map(f => `<button class="wiz-opt small" data-folder="${esc(f)}"><i data-lucide="folder"></i><span><b>${esc(f.slice(1))}</b></span><i data-lucide="chevron-right"></i></button>`).join('')
          : '<p class="hint">Nessuna cartella: creane una qui sotto.</p>';
        icons();
      }).catch(() => { $('#wizFolders').innerHTML = '<p class="hint">Non riesco a leggere le cartelle: creane una nuova qui sotto.</p>'; });
    }
    if (step === 'done') {
      body.innerHTML = `<div class="wiz-ok"><i data-lucide="cloud-upload"></i></div>
        <h2>Collegato!</h2>
        <p class="lead">Le idee si salvano in <b>${esc(Sync.cfg.folder)}</b>.</p>
        <p class="hint" id="wizProgress">Prima sincronizzazione in corso…</p>
        <ul class="wiz-list plain">
          <li><b>Elenco idee.md</b>: l’elenco leggibile anche dal PC</li>
          <li><b>Allegati</b>: foto, video, audio e disegni</li>
          <li><b>_app</b>: dati dell’app, da non toccare</li>
        </ul>
        <button class="btn primary wide" data-go="close">Fatto</button>`;
    }
    if (step === 'error') {
      body.innerHTML = `<h2>Collegamento non riuscito</h2>
        <p class="lead">Dropbox non ha confermato l’accesso. Controlla la connessione e riprova.</p>
        <button class="btn primary wide" data-go="login">Riprova</button>
        <button class="btn ghost wide" data-go="close">Chiudi</button>`;
    }
    icons();
  },
  async choose(folder) {
    Sync.cfg.folder = folder; Sync.cfg.authExpired = false; await Sync.saveAuth();
    this.show('done');
    await Sync.run('wizard');
    const el = $('#wizProgress');
    if (el) el.textContent = Sync.cfg.lastError || 'Sincronizzazione completata ✓';
  },
  bind() {
    $('#wizClose').onclick = () => this.close();
    $('#wizBody').onclick = async e => {
      const f = e.target.closest('[data-folder]'); if (f) return this.choose(f.dataset.folder);
      const b = e.target.closest('[data-go]'); if (!b) return;
      const go = b.dataset.go;
      if (go === 'auth') return Dropbox.connect().catch(() => toast('Collegamento non disponibile'));
      if (go === 'close') return this.close();
      if (go === 'mkdir') {
        const name = safeName($('#wizNew').value); if (!name) return;
        try { await Dropbox.mkdir(Sync.cfg.auth, '/' + name); } catch { toast('Non riesco a creare la cartella'); return; }
        return this.choose('/' + name);
      }
      this.show(go);
    };
  },
};
window.Sync = Sync;
const bindAll = () => { Sync.bind(); Wizard.bind(); };
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', bindAll) : bindAll();
