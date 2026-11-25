/* Idee — raccolta idee multimediale, tutto salvato in locale (IndexedDB). */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = () => window.lucide && lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
const COLORS = ['#5E9A84', '#4C7BD9', '#EE5D6C', '#E9A21B', '#8C63D6', '#2FA7B8', '#D86AA8', '#6B7590'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- DB ---------------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('idee-db', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const n of ['ideas', 'cats']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  all(store) {
    return new Promise((res, rej) => {
      const r = this.db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  },
  write(store, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, 'readwrite');
      fn(t.objectStore(store));
      t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  put(store, v) { return this.write(store, s => s.put(v)); },
  putMany(store, arr) { return this.write(store, s => arr.forEach(v => s.put(v))); },
  del(store, id) { return this.write(store, s => s.delete(id)); },
  getMeta(k) {
    return new Promise(res => {
      const r = this.db.transaction('meta').objectStore('meta').get(k);
      r.onsuccess = () => res(r.result); r.onerror = () => res(undefined);
    });
  },
  setMeta(k, v) { return this.write('meta', s => s.put(v, k)); },
};

/* ---------------- stati ---------------- */
const STATUSES = [
  { id: 'nuova', label: 'Nuova', icon: 'sparkles', color: '#4C7BD9' },
  { id: 'valutazione', label: 'In valutazione', icon: 'scale', color: '#E9A21B' },
  { id: 'corso', label: 'In corso', icon: 'hammer', color: '#8C63D6' },
  { id: 'fatta', label: 'Fatta', icon: 'circle-check', color: '#5E9A84' },
  { id: 'scartata', label: 'Scartata', icon: 'circle-x', color: '#8A93A8' },
];
const statusOf = id => STATUSES.find(x => x.id === id) || STATUSES[0];
const isDue = i => RC.isDue(i);
function normalizeIdea(i) {
  i.status ||= 'nuova';
  i.statusHistory ||= [{ status: i.status, at: i.createdAt }];
  i.updatedAt ||= i.createdAt;
  i.remindAt ??= null;
  i.remindRepeat ??= null;
  return i;
}
// called after every local change: bump sync clock + schedule cloud sync
function touched(i) { i.updatedAt = Date.now(); window.Sync?.schedule(); window.Push?.schedule(); }

/* ---------------- state ---------------- */
const S = { ideas: [], cats: [], filter: null, status: null, due: false, q: '', urls: [] };

const catById = id => S.cats.find(c => c.id === id);
const children = id => S.cats.filter(c => (c.parentId || null) === (id || null)).sort((a, b) => a.name.localeCompare(b.name, 'it'));
function descendants(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const c of S.cats) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; } }
  return out;
}
function catPath(id) {
  const parts = []; let c = catById(id), guard = 0;
  while (c && guard++ < 20) { parts.unshift(c.name); c = catById(c.parentId); }
  return parts.join(' › ');
}
const catColor = id => catById(id)?.color || null;
function flatTree(parentId = null, depth = 0, out = []) {
  for (const c of children(parentId)) { out.push({ c, depth }); flatTree(c.id, depth + 1, out); }
  return out;
}

/* ---------------- date helpers ---------------- */
const fmtTime = ts => new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const fmtFull = ts => new Date(ts).toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function dayLabel(ts) {
  const d = new Date(ts), t = new Date(); t.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((t - dd) / 864e5);
  const long = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) });
  if (diff === 0) return ['Oggi', long];
  if (diff === 1) return ['Ieri', long];
  return [long.charAt(0).toUpperCase() + long.slice(1), ''];
}
const dayKey = ts => new Date(ts).toDateString();

/* ---------------- ui helpers ---------------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
function openSheet(id) { const el = $('#' + id); el.hidden = false; el.classList.remove('leaving'); }
function closeSheet(id, fancy = false) {
  const el = $('#' + id);
  if (fancy && !reduceMotion) {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => { el.hidden = true; el.classList.remove('leaving'); }, { once: true });
  } else el.hidden = true;
}
function track(url) { S.urls.push(url); return url; }
function freeUrls() { S.urls.forEach(u => URL.revokeObjectURL(u)); S.urls = []; }

function ask({ title, value = '', color = null, msg = '', okText = 'OK', input = true }) {
  const d = $('#dlg');
  $('#dlgTitle').textContent = title;
  $('#dlgMsg').textContent = msg;
  $('#dlgOk').textContent = okText;
  const inp = $('#dlgInput'); inp.hidden = !input; inp.value = value;
  const cw = $('#dlgColors'); cw.innerHTML = ''; cw.hidden = !color;
  let chosen = color;
  if (color) COLORS.forEach(c => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sw' + (c === chosen ? ' on' : '');
    b.style.setProperty('--c', c); b.setAttribute('aria-label', 'Colore ' + c);
    b.onclick = () => { chosen = c; cw.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === b)); };
    cw.appendChild(b);
  });
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); d.close('ok'); } };
  d.showModal();
  if (input) setTimeout(() => inp.focus(), 50);
  return new Promise(res => {
    d.onclose = () => {
      if (d.returnValue !== 'ok') return res(null);
      if (input && !inp.value.trim()) return res(null);
      res({ value: inp.value.trim(), color: chosen });
    };
  });
}

/* ---------------- HOME ---------------- */
function renderChips() {
  const top = children(null);
  const active = S.filter ? (catById(S.filter)?.parentId ? rootOf(S.filter) : S.filter) : null;
  const chips = $('#chips');
  chips.innerHTML = `<button class="chip ${!S.filter ? 'on' : ''}" data-f="">Tutte</button>` +
    top.map(c => `<button class="chip ${active === c.id ? 'on' : ''}" data-f="${c.id}"><span class="dot" style="--c:${c.color}"></span>${esc(c.name)}</button>`).join('') +
    `<button class="chip" data-new="1" aria-label="Nuova categoria">+ Categoria</button>`;
  const sub = $('#subchips');
  if (active) {
    // show the whole subtree of the active root (flattened, with path)
    const items = flatTree(active);
    sub.hidden = !items.length;
    sub.innerHTML = `<button class="chip ${S.filter === active ? 'on' : ''}" data-f="${active}">Tutta «${esc(catById(active).name)}»</button>` +
      items.map(({ c, depth }) => `<button class="chip ${S.filter === c.id ? 'on' : ''}" data-f="${c.id}">${depth ? '· '.repeat(depth) : ''}${esc(c.name)}</button>`).join('');
  } else sub.hidden = true;
  $('#statuschips').innerHTML = `<button class="chip ${!S.status ? 'on' : ''}" data-s="">Tutti gli stati</button>` +
    STATUSES.map(st => {
      const n = S.ideas.filter(i => i.status === st.id).length;
      return `<button class="chip st ${S.status === st.id ? 'on' : ''}" data-s="${st.id}" style="--c:${st.color}"><i data-lucide="${st.icon}"></i>${st.label}${n ? ` <b>${n}</b>` : ''}</button>`;
    }).join('');
  const due = S.ideas.filter(isDue).length;
  const bn = $('#dueBanner');
  bn.hidden = !due && !S.due;
  bn.classList.toggle('on', S.due);
  bn.innerHTML = S.due
    ? `<i data-lucide="bell-ring"></i><span><b>Da riprendere</b> — stai vedendo solo queste</span><span class="bn-act">Mostra tutte</span>`
    : `<i data-lucide="bell-ring"></i><span><b>${due} ${due === 1 ? 'idea da riprendere' : 'idee da riprendere'}</b></span><span class="bn-act">Vedi</span>`;
  try { navigator.setAppBadge?.(due || undefined).catch(() => {}); if (!due) navigator.clearAppBadge?.().catch(() => {}); } catch {}
}
function rootOf(id) { let c = catById(id), g = 0; while (c?.parentId && g++ < 20) c = catById(c.parentId); return c?.id; }

function filteredIdeas() {
  let list = S.ideas;
  if (S.due) return [...list.filter(isDue)].sort((a, b) => (a.remindAt || 0) - (b.remindAt || 0));
  if (S.filter) { const set = descendants(S.filter); list = list.filter(i => set.has(i.catId)); }
  if (S.status) list = list.filter(i => i.status === S.status);
  if (S.q) {
    const q = S.q.toLowerCase();
    list = list.filter(i => (i.title + ' ' + i.text + ' ' + catPath(i.catId)).toLowerCase().includes(q));
  }
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

function renderList(enterId) {
  freeUrls();
  renderChips();
  $('#count').textContent = S.ideas.length || '';
  const list = filteredIdeas();
  const main = $('#list');
  if (!list.length) {
    const none = !S.ideas.length;
    main.innerHTML = `<div class="empty"><div class="bulb"><i data-lucide="${none ? 'lightbulb' : 'search-x'}"></i></div>
      <h2>${none ? 'La prima idea ti aspetta' : 'Nessuna idea qui'}</h2>
      <p>${none ? 'Tocca il cubo giallo e scrivi, detta, disegna, fotografa o registra.' : 'Prova un’altra categoria, un altro stato o un’altra parola.'}</p></div>`;
    icons(); return;
  }
  let html = '', last = '';
  for (const i of list) {
    const k = dayKey(i.createdAt);
    if (k !== last) {
      const [a, b] = dayLabel(i.createdAt);
      const n = list.filter(x => dayKey(x.createdAt) === k).length;
      html += `<div class="day">${esc(a)} <small>${esc(b)}${b ? ' — ' : ''}${n} ${n === 1 ? 'idea' : 'idee'}</small></div>`;
      last = k;
    }
    const col = catColor(i.catId);
    const title = i.title || firstLine(i.text) || mediaTitle(i);
    const body = i.title ? i.text : restLines(i.text);
    const imgs = i.blocks.filter(b => b.type === 'image' || b.type === 'drawing').slice(0, 3);
    const counts = countBlocks(i);
    html += `<button class="idea ${i.id === enterId ? 'enter' : ''}" data-id="${i.id}" ${col ? `style="--c:${col}"` : ''}>
      <span class="time">${fmtTime(i.createdAt)}</span>
      <span class="catline"><span class="cl">${i.catId ? `<span class="dot" style="--c:${col}"></span>${esc(catPath(i.catId))}` : 'Senza categoria'}</span>${statusBadge(i)}</span>
      <h4>${esc(title)}</h4>
      ${body ? `<p>${esc(body)}</p>` : ''}
      ${remindChip(i)}
      ${imgs.length || counts.length ? `<span class="media-strip">
        ${imgs.map(b => `<img class="thumb" alt="" src="${track(URL.createObjectURL(b.blob))}">`).join('')}
        ${counts.map(([ic, n]) => `<span class="mtag"><i data-lucide="${ic}"></i>${n}</span>`).join('')}
      </span>` : ''}
    </button>`;
  }
  main.innerHTML = html;
  icons();
}
function remindText(i) {
  if (!RC.active(i)) return '';
  return (i.remindRepeat ? RC.repeatLabel(i.remindRepeat) + ' · prossimo ' : '') + fmtRemind(i.remindAt);
}
function remindChip(i) {
  if (!RC.active(i) && !i.remindPending) return '';
  const due = isDue(i);
  return `<span class="remind ${due ? 'due' : ''}"><i data-lucide="${due ? 'bell-ring' : i.remindRepeat ? 'repeat' : 'bell'}"></i>${due && i.remindRepeat ? 'Da riprendere · ' : ''}${esc(remindText(i))}${i.snoozeUntil ? ' · rimandato a ' + esc(fmtRemind(i.snoozeUntil)) : ''}</span>`;
}
function statusBadge(i) {
  const st = statusOf(i.status);
  return `<span class="sbadge" style="--c:${st.color}"><i data-lucide="${st.icon}"></i>${st.label}</span>`;
}
function fmtRemind(ts) {
  const d = new Date(ts), t = new Date(), tm = new Date(); tm.setDate(t.getDate() + 1);
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === t.toDateString()) return 'Oggi ' + hm;
  if (d.toDateString() === tm.toDateString()) return 'Domani ' + hm;
  return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hm;
}
const firstLine = t => (t || '').trim().split('\n')[0].slice(0, 90);
const restLines = t => (t || '').trim().split('\n').slice(1).join(' ').trim() || ((t || '').trim().length > 90 ? (t || '').trim().slice(90) : '');
function mediaTitle(i) {
  const t = i.blocks[0]?.type;
  return ({ image: 'Foto', video: 'Video', audio: 'Nota vocale', drawing: 'Disegno' })[t] || 'Idea';
}
function countBlocks(i) {
  const out = [];
  const vis = i.blocks.filter(b => b.type === 'image' || b.type === 'drawing').length;
  if (vis > 3) out.push(['images', '+' + (vis - 3)]);
  for (const [t, ic] of [['video', 'video'], ['audio', 'audio-lines']]) {
    const n = i.blocks.filter(b => b.type === t).length;
    if (n) out.push([ic, n]);
  }
  return out;
}

/* ---------------- COMPOSER ---------------- */
let draft = null, editingId = null;

function catOptions(sel) {
  return `<option value="">Senza categoria</option>` + flatTree().map(({ c, depth }) =>
    `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${' '.repeat(depth)}${depth ? '↳ ' : ''}${esc(c.name)}</option>`).join('');
}
function openComposer(idea = null, preset = null) {
  stopDictation();
  editingId = idea?.id || null;
  draft = idea ? { ...idea, blocks: idea.blocks.map(b => ({ ...b })) }
    : normalizeIdea({ id: uid(), createdAt: Date.now(), title: '', text: '', catId: S.filter || null, blocks: [] });
  $('#cmpTitle').value = draft.title;
  $('#cmpStatus').innerHTML = STATUSES.map(st => `<option value="${st.id}" ${st.id === draft.status ? 'selected' : ''}>${st.label}</option>`).join('');
  renderCmpRemind();
  $('#cmpText').value = draft.text;
  $('#cmpCat').innerHTML = catOptions(draft.catId);
  updateStamp();
  renderBlocks();
  openSheet('composer');
  if (preset) preset();
  else if (!idea) setTimeout(() => $('#cmpText').focus(), 350);
}
function updateStamp() {
  const d = new Date(draft.createdAt);
  $('#cmpStamp').innerHTML = `<b>${fmtTime(draft.createdAt)}</b>${d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}${editingId ? ' · modifica' : ''}`;
}
function blockKind(t) {
  return ({ image: ['image', 'Foto'], video: ['video', 'Video'], audio: ['audio-lines', 'Audio'], drawing: ['pen-tool', 'Disegno'] })[t];
}
function renderBlocks() {
  const wrap = $('#cmpBlocks');
  wrap.querySelectorAll('[data-url]').forEach(el => URL.revokeObjectURL(el.dataset.url));
  wrap.innerHTML = draft.blocks.map((b, idx) => {
    const url = URL.createObjectURL(b.blob);
    const [ic, label] = blockKind(b.type);
    const media = b.type === 'video' ? `<video src="${url}" data-url="${url}" playsinline muted preload="metadata"></video>`
      : b.type === 'audio' ? `<audio src="${url}" data-url="${url}" controls preload="metadata"></audio>`
      : `<img src="${url}" data-url="${url}" alt="${label}">`;
    return `<div class="block ${b.type}">${media}
      <span class="kind"><i data-lucide="${ic}"></i>${label}</span>
      <button class="rm" data-rm="${idx}" aria-label="Rimuovi ${label}"><i data-lucide="x"></i></button></div>`;
  }).join('');
  icons();
}
function addBlock(type, blob) {
  draft.blocks.push({ id: uid(), type, blob, mime: blob.type, addedAt: Date.now() });
  renderBlocks();
  $('#cmpBlocks').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function saveDraft() {
  stopDictation();
  draft.title = $('#cmpTitle').value.trim();
  draft.text = $('#cmpText').value.trim();
  draft.catId = $('#cmpCat').value || null;
  setStatus(draft, $('#cmpStatus').value);
  if (!draft.title && !draft.text && !draft.blocks.length) { toast('Aggiungi almeno un testo o un contenuto'); return; }
  if (editingId) {
    draft.editedAt = Date.now();
    const old = S.ideas.find(x => x.id === editingId);
    const keep = new Set(draft.blocks.map(b => b.id));
    const gone = (old?.blocks || []).filter(b => !keep.has(b.id) && b.remotePath).map(b => b.remotePath);
    if (gone.length) window.Sync?.forget(gone);
  }
  touched(draft);
  try {
    await DB.put('ideas', draft);
  } catch (e) {
    toast('Salvataggio non riuscito: memoria piena?'); console.error(e); return;
  }
  const i = S.ideas.findIndex(x => x.id === draft.id);
  if (i >= 0) S.ideas[i] = draft; else S.ideas.push(draft);
  const id = draft.id, wasEdit = !!editingId;
  draft = null;
  $('#cmpBlocks').innerHTML = '';
  closeSheet('composer', true);
  if (wasEdit) { closeSheet('detail'); }
  renderList(id);
  toast(wasEdit ? 'Idea aggiornata' : 'Idea salvata');
}
async function closeComposer() {
  stopDictation();
  const dirty = draft && ($('#cmpTitle').value.trim() || $('#cmpText').value.trim() || draft.blocks.length);
  if (dirty && !editingId) {
    const r = await ask({ title: 'Scartare questa idea?', msg: 'Testo e allegati non salvati andranno persi.', okText: 'Scarta', input: false });
    if (!r) return;
  }
  draft = null; closeSheet('composer');
}

/* ---- dictation (speech-to-text) ---- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, dictating = false;
function startDictation() {
  if (!SR) { toast('Dettatura non supportata qui: usa il microfono della tastiera'); $('#cmpText').focus(); return; }
  rec = new SR(); rec.lang = 'it-IT'; rec.continuous = true; rec.interimResults = true;
  rec.onresult = e => {
    let interim = '';
    for (let k = e.resultIndex; k < e.results.length; k++) {
      const r = e.results[k];
      if (r.isFinal) {
        const ta = $('#cmpText'), t = r[0].transcript.trim();
        ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + t.charAt(0).toUpperCase() + t.slice(1);
      } else interim += r[0].transcript;
    }
    $('#interim').textContent = interim;
  };
  rec.onerror = e => { if (e.error === 'not-allowed') toast('Consenti il microfono per dettare'); };
  rec.onend = () => { if (dictating) { try { rec.start(); } catch { stopDictation(); } } };
  try { rec.start(); dictating = true; $('#tDictate').classList.add('live'); $('#tDictate span').textContent = 'Stop'; }
  catch { toast('Microfono non disponibile'); }
}
function stopDictation() {
  dictating = false;
  if (rec) { try { rec.stop(); } catch {} rec = null; }
  $('#interim').textContent = '';
  $('#tDictate').classList.remove('live'); $('#tDictate span').textContent = 'Detta';
}

/* ---- audio recorder ---- */
let mr = null, recChunks = [], recStart = 0, recTimer, recStream, recCancelled = false, audioCtx, raf;
async function startAudio() {
  stopDictation();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Registrazione non supportata: scegli un audio dalla galleria'); $('#inFile').click(); return;
  }
  try { recStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { toast('Consenti l’uso del microfono per registrare'); return; }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'].find(m => MediaRecorder.isTypeSupported?.(m));
  mr = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
  recChunks = []; recCancelled = false;
  mr.ondataavailable = e => e.data.size && recChunks.push(e.data);
  mr.onstop = () => {
    recStream.getTracks().forEach(t => t.stop());
    cancelAnimationFrame(raf); audioCtx?.close().catch(() => {});
    $('#recorder').hidden = true; clearInterval(recTimer);
    if (!recCancelled && recChunks.length) addBlock('audio', new Blob(recChunks, { type: mr.mimeType || 'audio/webm' }));
  };
  mr.start(250); recStart = Date.now();
  $('#recTime').textContent = '0:00'; $('#recorder').hidden = false;
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $('#recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  // level meter -> orb scale
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const an = audioCtx.createAnalyser(); an.fftSize = 256;
    audioCtx.createMediaStreamSource(recStream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const loop = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128));
      $('#recOrb').style.setProperty('--lvl', (1 + m / 160).toFixed(3)); raf = requestAnimationFrame(loop); };
    loop();
  } catch {}
}

/* ---- drawing ---- */
const D = { ctx: null, color: '#18233F', size: 5, drawing: false, undo: [], last: null };
const DRAW_COLORS = ['#18233F', '#EE5D6C', '#4C7BD9', '#5E9A84', '#E9A21B', '#8C63D6', '#FFFFFF'];
const DRAW_SIZES = [3, 6, 12, 24];
function openDraw() {
  stopDictation();
  const el = $('#draw'); el.hidden = false;
  const cv = $('#canvas'), dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  D.ctx = cv.getContext('2d'); D.ctx.scale(dpr, dpr);
  D.ctx.fillStyle = '#fff'; D.ctx.fillRect(0, 0, innerWidth, innerHeight);
  D.ctx.lineCap = 'round'; D.ctx.lineJoin = 'round';
  D.undo = [];
  $('#swatches').innerHTML = DRAW_COLORS.map(c => `<button class="sw ${c === D.color ? 'on' : ''}" style="--c:${c}" data-c="${c}" aria-label="Colore${c === '#FFFFFF' ? ' bianco (gomma)' : ''}"></button>`).join('');
  $('#sizes').innerHTML = DRAW_SIZES.map(s => `<button class="sz ${s === D.size ? 'on' : ''}" data-s="${s}" aria-label="Spessore ${s}"><span style="width:${Math.min(s, 22)}px;height:${Math.min(s, 22)}px"></span></button>`).join('');
}
function snapshot() { const cv = $('#canvas'); D.undo.push(D.ctx.getImageData(0, 0, cv.width, cv.height)); if (D.undo.length > 25) D.undo.shift(); }
function drawPoint(e, start) {
  const p = { x: e.clientX, y: e.clientY };
  const w = D.size * (e.pressure && e.pointerType === 'pen' ? 0.4 + e.pressure : 1);
  D.ctx.strokeStyle = D.color; D.ctx.lineWidth = w;
  D.ctx.beginPath();
  const from = start || !D.last ? p : D.last;
  D.ctx.moveTo(from.x, from.y); D.ctx.lineTo(p.x + (start ? .01 : 0), p.y); D.ctx.stroke();
  D.last = p;
}

/* ---------------- DETAIL ---------------- */
let currentId = null;
function openDetail(id) {
  const i = S.ideas.find(x => x.id === id); if (!i) return;
  currentId = id;
  $('#detStamp').innerHTML = `<b>${fmtTime(i.createdAt)}</b>${new Date(i.createdAt).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`;
  const col = catColor(i.catId);
  const body = $('#detBody');
  body.querySelectorAll('[data-url]').forEach(el => URL.revokeObjectURL(el.dataset.url));
  body.innerHTML = `
    <span class="det-cat">${i.catId ? `<span class="dot" style="--c:${col}"></span>${esc(catPath(i.catId))}` : 'Senza categoria'}</span>
    <h2 class="det-title">${esc(i.title || firstLine(i.text) || mediaTitle(i))}</h2>
    ${(i.title ? i.text : (i.text || '').trim().split('\n').slice(1).join('\n').trim()) ? `<p class="det-text">${esc(i.title ? i.text : (i.text || '').trim().split('\n').slice(1).join('\n').trim())}</p>` : ''}
    <div class="det-section">
      <h3>Stato</h3>
      <div class="status-pills">${STATUSES.map(st => `<button class="spill ${st.id === i.status ? 'on' : ''}" data-status="${st.id}" style="--c:${st.color}"><i data-lucide="${st.icon}"></i>${st.label}</button>`).join('')}</div>
    </div>
    <div class="det-section">
      <h3>Promemoria</h3>
      ${RC.active(i) || i.remindPending ? `
        ${isDue(i) ? `<div class="rem-due"><i data-lucide="bell-ring"></i><b>Da riprendere</b>
          <span class="row"><button class="btn small primary" data-rem="done"><i data-lucide="check"></i>Fatto</button>
          <button class="btn small" data-rem="snooze"><i data-lucide="alarm-clock"></i>${esc(RC.snoozeChoice().label)}</button></span></div>` : ''}
        ${RC.active(i) ? `<p class="rem-line"><i data-lucide="${i.remindRepeat ? 'repeat' : 'bell'}"></i>${i.remindRepeat ? esc(RC.repeatLabel(i.remindRepeat)) + ' · prossimo: ' : ''}${esc(fmtFull(i.remindAt))}</p>` : ''}
        ${i.snoozeUntil ? `<p class="rem-line"><i data-lucide="alarm-clock"></i>Rimandato a ${esc(fmtFull(i.snoozeUntil))}</p>` : ''}
        <div class="rem-actions">
          <button class="btn small" data-cal="google"><i data-lucide="calendar-plus"></i>Google Calendar</button>
          <button class="btn small" data-cal="outlook"><i data-lucide="calendar-plus"></i>Outlook</button>
          <button class="btn small" data-cal="ics"><i data-lucide="calendar-arrow-down"></i>File calendario</button>
        </div>
        <div class="rem-actions">
          <button class="btn small" data-rem="edit"><i data-lucide="clock"></i>Modifica</button>
          <button class="btn small" data-rem="clear"><i data-lucide="bell-off"></i>Togli</button>
        </div>`
      : `<button class="btn small" data-rem="edit"><i data-lucide="bell-plus"></i>Imposta promemoria</button>`}
    </div>
    <div class="det-media" style="margin-top:22px">${i.blocks.map(b => {
      const u = URL.createObjectURL(b.blob);
      return b.type === 'video' ? `<video src="${u}" data-url="${u}" controls playsinline preload="metadata"></video>`
        : b.type === 'audio' ? `<audio src="${u}" data-url="${u}" controls preload="metadata"></audio>`
        : `<img src="${u}" data-url="${u}" alt="${b.type === 'drawing' ? 'Disegno' : 'Foto'}">`;
    }).join('')}</div>
    <p class="det-meta">Creata ${esc(fmtFull(i.createdAt))}${i.editedAt ? `<br>Modificata ${esc(fmtFull(i.editedAt))}` : ''}
      ${i.statusHistory.length > 1 ? '<br>' + i.statusHistory.slice(1).map(h => `${esc(statusOf(h.status).label)}: ${esc(fmtFull(h.at))}`).join('<br>') : ''}</p>`;
  $('#toast').classList.remove('show');
  openSheet('detail'); icons();
}
async function deleteCurrent() {
  const r = await ask({ title: 'Eliminare questa idea?', msg: 'Verranno eliminati anche foto, video, audio e disegni collegati.', okText: 'Elimina', input: false });
  if (!r) return;
  const dead = S.ideas.find(x => x.id === currentId);
  window.Sync?.tombstone(currentId, dead.blocks.filter(b => b.remotePath).map(b => b.remotePath));
  await DB.del('ideas', currentId);
  S.ideas = S.ideas.filter(x => x.id !== currentId);
  closeSheet('detail'); renderList(); toast('Idea eliminata');
}
async function shareCurrent() {
  const i = S.ideas.find(x => x.id === currentId); if (!i) return;
  const text = [i.title, i.text, `— ${fmtFull(i.createdAt)}${i.catId ? ' · ' + catPath(i.catId) : ''}`].filter(Boolean).join('\n\n');
  const files = i.blocks.map((b, k) => new File([b.blob], `idea-${k + 1}.${ext(b.mime || b.blob.type)}`, { type: b.blob.type }));
  try {
    if (files.length && navigator.canShare?.({ files })) await navigator.share({ title: i.title || 'Idea', text, files });
    else if (navigator.share) await navigator.share({ title: i.title || 'Idea', text });
    else { await navigator.clipboard.writeText(text); toast('Testo copiato'); }
  } catch (e) { if (e.name !== 'AbortError') toast('Condivisione non riuscita'); }
}
function ext(m = '') {
  if (m.includes('png')) return 'png'; if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webm')) return 'webm'; if (m.includes('mp4')) return 'mp4'; if (m.includes('quicktime')) return 'mov';
  if (m.includes('aac')) return 'aac'; if (m.includes('mpeg')) return 'mp3'; return (m.split('/')[1] || 'bin').split(';')[0];
}

/* ---------------- CATEGORIES ---------------- */
function renderTree() {
  const items = flatTree();
  $('#tree').innerHTML = items.length ? items.map(({ c, depth }) => {
    const n = S.ideas.filter(i => descendants(c.id).has(i.catId)).length;
    return `<li style="--d:${Math.min(depth, 4)}">
      <span class="dot" style="--c:${c.color}"></span>
      <span class="name">${esc(c.name)}</span><span class="n">${n}</span>
      <button class="icon-btn" data-act="sub" data-id="${c.id}" aria-label="Nuova sottocategoria di ${esc(c.name)}"><i data-lucide="corner-down-right"></i></button>
      <button class="icon-btn" data-act="edit" data-id="${c.id}" aria-label="Rinomina ${esc(c.name)}"><i data-lucide="pencil"></i></button>
      <button class="icon-btn danger" data-act="del" data-id="${c.id}" aria-label="Elimina ${esc(c.name)}"><i data-lucide="trash-2"></i></button>
    </li>`;
  }).join('') : `<p class="hint">Nessuna categoria. Creane una con «Nuova».</p>`;
  icons();
}
async function addCat(parentId = null) {
  const parent = catById(parentId);
  const r = await ask({ title: parent ? `Sottocategoria di «${parent.name}»` : 'Nuova categoria', color: parent?.color || COLORS[S.cats.length % COLORS.length] });
  if (!r) return null;
  const c = { id: uid(), name: r.value, color: r.color, parentId: parentId || null, createdAt: Date.now(), updatedAt: Date.now() };
  await DB.put('cats', c); S.cats.push(c); window.Sync?.schedule();
  renderTree(); renderList(); return c;
}
async function editCat(id) {
  const c = catById(id);
  const r = await ask({ title: 'Rinomina categoria', value: c.name, color: c.color });
  if (!r) return;
  c.name = r.value; c.color = r.color; c.updatedAt = Date.now(); await DB.put('cats', c); window.Sync?.schedule();
  renderTree(); renderList();
}
async function delCat(id) {
  const c = catById(id);
  const kids = S.cats.filter(x => x.parentId === id);
  const n = S.ideas.filter(i => i.catId === id).length;
  const to = c.parentId ? `«${catById(c.parentId).name}»` : 'Senza categoria';
  const r = await ask({ title: `Eliminare «${c.name}»?`, input: false, okText: 'Elimina',
    msg: `${n ? `${n} ${n === 1 ? 'idea passa' : 'idee passano'} a ${to}. ` : ''}${kids.length ? `Le ${kids.length} sottocategorie salgono di un livello. ` : ''}Nessuna idea viene cancellata.` });
  if (!r) return;
  const movedIdeas = S.ideas.filter(i => i.catId === id); movedIdeas.forEach(i => { i.catId = c.parentId || null; touched(i); });
  kids.forEach(k => { k.parentId = c.parentId || null; k.updatedAt = Date.now(); });
  window.Sync?.tombstoneCat(id);
  if (movedIdeas.length) await DB.putMany('ideas', movedIdeas);
  if (kids.length) await DB.putMany('cats', kids);
  await DB.del('cats', id); S.cats = S.cats.filter(x => x.id !== id);
  if (S.filter && !catById(S.filter)) S.filter = null;
  renderTree(); renderList(); toast('Categoria eliminata');
}

/* ---------------- BACKUP ---------------- */
const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function exportBackup() {
  toast('Preparo il backup…');
  const ideas = [];
  for (const i of S.ideas) ideas.push({ ...i, blocks: await Promise.all(i.blocks.map(async b => ({ ...b, blob: undefined, data: await blobToB64(b.blob) }))) });
  const json = JSON.stringify({ app: 'idee', version: 1, exportedAt: new Date().toISOString(), cats: S.cats, ideas });
  const file = new File([json], `idee-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Backup Idee' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'idee') throw new Error('formato');
    const known = new Set(S.ideas.map(i => i.id)), knownC = new Set(S.cats.map(c => c.id));
    const cats = data.cats.filter(c => !knownC.has(c.id));
    const ideas = [];
    for (const i of data.ideas) if (!known.has(i.id)) {
      ideas.push({ ...i, blocks: await Promise.all(i.blocks.map(async b => { const blob = await (await fetch(b.data)).blob(); const { data: _, ...rest } = b; return { ...rest, blob }; })) });
    }
    if (cats.length) await DB.putMany('cats', cats);
    if (ideas.length) await DB.putMany('ideas', ideas);
    ideas.forEach(normalizeIdea);
    S.cats.push(...cats); S.ideas.push(...ideas); window.Sync?.schedule();
    renderList(); renderStorage();
    toast(`Ripristinate ${ideas.length} idee e ${cats.length} categorie`);
  } catch (e) { console.error(e); toast('File non valido: scegli un backup di Idee'); }
}
async function renderStorage() {
  const el = $('#storageInfo');
  const est = await navigator.storage?.estimate?.();
  const n = S.ideas.length, m = S.ideas.reduce((a, i) => a + i.blocks.length, 0);
  el.textContent = `${n} idee, ${m} allegati` + (est ? ` · ${(est.usage / 1048576).toFixed(1)} MB usati su ${(est.quota / 1073741824).toFixed(1)} GB disponibili` : '');
}

/* ---------------- STATO ---------------- */
function setStatus(i, st) {
  if (!st || st === i.status) return false;
  i.status = st;
  i.statusHistory = [...(i.statusHistory || []), { status: st, at: Date.now() }];
  return true;
}
async function changeStatus(id, st) {
  const i = S.ideas.find(x => x.id === id);
  if (!i || !setStatus(i, st)) return;
  touched(i); await DB.put('ideas', i);
  openDetail(id); renderList();
  toast('Stato: ' + statusOf(st).label);
}

/* ---------------- PROMEMORIA ---------------- */
function presetTimes() {
  const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.getTime(); };
  const now = new Date(), tom = new Date(); tom.setDate(now.getDate() + 1);
  const mon = new Date(); mon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const week = new Date(); week.setDate(now.getDate() + 7);
  const month = new Date(); month.setMonth(now.getMonth() + 1);
  const out = [];
  if (now.getHours() < 17) out.push(['Stasera', at(now, 18)]);
  out.push(['Domani mattina', at(tom, 9)], ['Lunedì', at(mon, 9)], ['Tra una settimana', at(week, 9)], ['Tra un mese', at(month, 9)]);
  return out;
}
const toLocalInput = ts => { const d = new Date(ts - new Date(ts).getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); };
function pickReminder(current, repeat) {
  const d = $('#remDlg');
  $('#remPresets').innerHTML = presetTimes().map(([l, ts]) =>
    `<button type="button" class="chip" data-ts="${ts}">${l}<small>${esc(fmtRemind(ts))}</small></button>`).join('');
  const inp = $('#remInput');
  inp.value = toLocalInput(current || presetTimes()[0][1]);
  inp.min = toLocalInput(Date.now());
  $('#remClear').hidden = !current;
  $('#remRepeat').innerHTML = RC.REPEATS.map(([v, l]) => `<option value="${v}" ${v === (repeat || '') ? 'selected' : ''}>${l}</option>`).join('');
  d.showModal(); icons();
  const out = ts => ({ ts, repeat: $('#remRepeat').value || null });
  return new Promise(res => {
    $('#remPresets').onclick = e => { const b = e.target.closest('[data-ts]'); if (b) { d.close(); res(out(+b.dataset.ts)); } };
    $('#remClear').onclick = () => { d.close(); res(0); };
    $('#remOk').onclick = () => { const v = new Date(inp.value).getTime(); d.close(); res(isNaN(v) ? undefined : out(v)); };
    $('#remCancel').onclick = () => { d.close(); res(undefined); };
    d.oncancel = () => res(undefined);
  });
}
function renderCmpRemind() {
  const has = RC.active(draft);
  $('#cmpRemind').innerHTML = `<i data-lucide="${has ? (draft.remindRepeat ? 'repeat' : 'bell') : 'bell-plus'}"></i><span>${has ? esc(fmtRemind(draft.remindAt)) + (draft.remindRepeat ? ' · ' + esc(RC.repeatLabel(draft.remindRepeat).toLowerCase()) : '') : 'Promemoria'}</span>`;
  $('#cmpRemind').classList.toggle('set', !!has);
  icons();
}
function applyReminder(i, r) {
  if (r === undefined) return false;
  Object.assign(i, { remindDone: false, remindNotified: false, remindPending: false, snoozeUntil: null });
  if (r === 0) { i.remindAt = null; i.remindRepeat = null; return true; }
  i.remindAt = r.ts; i.remindRepeat = r.repeat;
  Reminders.askPermission();
  return true;
}
async function editReminderOf(id) {
  const i = S.ideas.find(x => x.id === id); if (!i) return;
  const r = await pickReminder(RC.active(i) ? i.remindAt : null, i.remindRepeat);
  if (!applyReminder(i, r)) return;
  touched(i); await DB.put('ideas', i);
  openDetail(id); renderList();
  toast(r ? 'Promemoria: ' + fmtRemind(r.ts) + (r.repeat ? ' · ' + RC.repeatLabel(r.repeat).toLowerCase() : '') : 'Promemoria tolto');
}
async function reminderAct(id, fn, msg) {
  const i = S.ideas.find(x => x.id === id); if (!i) return;
  fn(i); touched(i); await DB.put('ideas', i);
  openDetail(id); renderList(); toast(msg);
}
const reminderDone = id => reminderAct(id, i => RC.done(i), 'Fatto' );
const reminderSnooze = id => { const sn = RC.snoozeChoice(); return reminderAct(id, i => RC.snooze(i, sn.ts), 'Rimandato: ' + fmtRemind(sn.ts)); };
const reminderClear = id => reminderAct(id, i => applyReminder(i, 0), 'Promemoria tolto');
function calendarLink(i, kind) {
  const title = '💡 ' + (i.title || firstLine(i.text) || 'Idea');
  const desc = [i.text, i.catId ? 'Categoria: ' + catPath(i.catId) : '', 'Apri Idee: ' + location.origin + location.pathname].filter(Boolean).join('\n\n');
  const start = new Date(i.remindAt), end = new Date(i.remindAt + 15 * 6e4);
  const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const rr = RC.rrule(i.remindRepeat);
  if (kind === 'google') return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${z(start)}/${z(end)}&details=${encodeURIComponent(desc)}${rr ? '&recur=' + encodeURIComponent('RRULE:' + rr) : ''}`;
  if (kind === 'outlook') return `https://outlook.office.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(title)}&startdt=${start.toISOString()}&enddt=${end.toISOString()}&body=${encodeURIComponent(desc)}`;
  const icsEsc = t => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Idee//IT', 'BEGIN:VEVENT', `UID:${i.id}@idee`, `DTSTAMP:${z(new Date())}`,
    `DTSTART:${z(start)}`, `DTEND:${z(end)}`, ...(rr ? ['RRULE:' + rr] : []), `SUMMARY:${icsEsc(title)}`, `DESCRIPTION:${icsEsc(desc)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(title)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
async function addToCalendar(id, kind) {
  const i = S.ideas.find(x => x.id === id); if (!i?.remindAt) return;
  if (kind !== 'ics') { window.open(calendarLink(i, kind), '_blank'); return; }
  const file = new File([calendarLink(i, 'ics')], 'promemoria-idea.ics', { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// In-app notifications: only while the app is open or reopened (a web app cannot wake up by itself).
const Reminders = {
  start() { this.check(); setInterval(() => this.check(), 30000); document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.check()); },
  async askPermission() {
    // al primo promemoria propone di attivare le notifiche sul telefono
    if (!window.Push?.configured || !Push.supported || Notification.permission !== 'default') return;
    const r = await ask({ title: 'Avvisarti sul telefono?', input: false, okText: 'Sì, attiva',
      msg: 'Ricevi la notifica all’ora del promemoria anche con l’app chiusa. Il telefono ti chiederà il permesso.' });
    if (r) Push.enable();
  },
  async check() {
    const fresh = S.ideas.filter(i => RC.firing(i).length);
    if (!fresh.length) return;
    for (const i of fresh) {
      RC.fire(i); await DB.put('ideas', i);
      try {
        if (Notification?.permission === 'granted') {
          const reg = await navigator.serviceWorker?.getRegistration();
          reg ? reg.showNotification(RC.title(i), RC.notifOptions(i)) : new Notification(RC.title(i), RC.notifOptions(i));
        }
      } catch {}
    }
    window.Sync?.schedule(); window.Push?.schedule();
    if (document.visibilityState === 'visible') toast(fresh.length === 1 ? 'Hai un’idea da riprendere' : `Hai ${fresh.length} idee da riprendere`);
    renderList();
  },
};

/* ---------------- events ---------------- */
function bind() {
  // home
  $('#fab').onclick = () => {
    const f = $('#fab'); f.classList.remove('burst'); void f.offsetWidth; f.classList.add('burst');
    setTimeout(() => openComposer(), reduceMotion ? 0 : 220);
  };
  $('#fab').addEventListener('animationend', () => $('#fab').classList.remove('burst'));
  $('#list').onclick = e => { const b = e.target.closest('.idea'); if (b) openDetail(b.dataset.id); };
  const onChip = async e => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (b.dataset.new) { const c = await addCat(); if (c) { S.filter = c.id; renderList(); } return; }
    S.filter = b.dataset.f || null; renderList();
  };
  $('#chips').onclick = onChip; $('#subchips').onclick = onChip;
  $('#statuschips').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; S.status = b.dataset.s || null; renderList(); };
  $('#dueBanner').onclick = () => { S.due = !S.due; renderList(); scrollTo({ top: 0, behavior: 'smooth' }); };
  $('#cmpRemind').onclick = async () => { const r = await pickReminder(RC.active(draft) ? draft.remindAt : null, draft.remindRepeat); if (applyReminder(draft, r)) renderCmpRemind(); };
  $('#detBody').onclick = e => {
    const st = e.target.closest('[data-status]'); if (st) return changeStatus(currentId, st.dataset.status);
    const cal = e.target.closest('[data-cal]'); if (cal) return addToCalendar(currentId, cal.dataset.cal);
    const rm = e.target.closest('[data-rem]'); if (rm) return ({ done: reminderDone, snooze: reminderSnooze, clear: reminderClear, edit: editReminderOf })[rm.dataset.rem](currentId);
  };
  $('#btnSearch').onclick = () => { $('#searchbar').hidden = false; $('#q').focus(); };
  $('#btnSearchClose').onclick = () => { $('#searchbar').hidden = true; $('#q').value = ''; S.q = ''; renderList(); };
  $('#q').oninput = e => { S.q = e.target.value.trim(); renderList(); };
  $('#btnCats').onclick = () => { renderTree(); openSheet('cats'); };
  $('#btnSettings').onclick = () => { renderStorage(); window.Push?.render(); openSheet('settings'); };

  // composer
  $('#cmpClose').onclick = closeComposer;
  $('#cmpSave').onclick = saveDraft;
  $('#cmpBlocks').onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { draft.blocks.splice(+b.dataset.rm, 1); renderBlocks(); } };
  $('#tDictate').onclick = () => dictating ? stopDictation() : startDictation();
  $('#tAudio').onclick = startAudio;
  $('#tDraw').onclick = openDraw;
  $('#tPhoto').onclick = () => $('#inPhoto').click();
  $('#tVideo').onclick = () => $('#inVideo').click();
  $('#tFile').onclick = () => $('#inFile').click();
  const onFiles = e => {
    for (const f of e.target.files) {
      const t = f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : f.type.startsWith('image') ? 'image' : null;
      if (t) addBlock(t, f); else toast('Formato non supportato: ' + f.name);
    }
    e.target.value = '';
  };
  ['#inPhoto', '#inVideo', '#inFile'].forEach(s => $(s).onchange = onFiles);
  if (!SR) $('#tDictate').title = 'Usa il microfono della tastiera';

  // recorder
  $('#recStop').onclick = () => mr?.state !== 'inactive' && mr.stop();
  $('#recCancel').onclick = () => { recCancelled = true; mr?.state !== 'inactive' && mr.stop(); };

  // draw
  const cv = $('#canvas');
  cv.addEventListener('pointerdown', e => { snapshot(); D.drawing = true; D.last = null; cv.setPointerCapture(e.pointerId); drawPoint(e, true); });
  cv.addEventListener('pointermove', e => { if (!D.drawing) return; (e.getCoalescedEvents?.() || [e]).forEach(ev => drawPoint(ev)); });
  const end = () => { D.drawing = false; D.last = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  $('#swatches').onclick = e => { const b = e.target.closest('.sw'); if (!b) return; D.color = b.dataset.c; $('#swatches').querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === b)); };
  $('#sizes').onclick = e => { const b = e.target.closest('.sz'); if (!b) return; D.size = +b.dataset.s; $('#sizes').querySelectorAll('.sz').forEach(x => x.classList.toggle('on', x === b)); };
  $('#drwUndo').onclick = () => { const s = D.undo.pop(); if (s) D.ctx.putImageData(s, 0, 0); };
  $('#drwClear').onclick = () => { snapshot(); D.ctx.fillStyle = '#fff'; D.ctx.fillRect(0, 0, innerWidth, innerHeight); };
  $('#drwCancel').onclick = () => { $('#draw').hidden = true; };
  $('#drwDone').onclick = () => {
    if (!D.undo.length) { $('#draw').hidden = true; return; }
    cv.toBlob(b => { $('#draw').hidden = true; if (b) addBlock('drawing', b); }, 'image/png');
  };

  // detail
  $('#detClose').onclick = () => closeSheet('detail');
  $('#detEdit').onclick = () => { const i = S.ideas.find(x => x.id === currentId); if (i) openComposer(i); };
  $('#detDelete').onclick = deleteCurrent;
  $('#detShare').onclick = shareCurrent;

  // categories
  $('#catClose').onclick = () => closeSheet('cats');
  $('#catAdd').onclick = () => addCat();
  $('#tree').onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    ({ sub: () => addCat(b.dataset.id), edit: () => editCat(b.dataset.id), del: () => delCat(b.dataset.id) })[b.dataset.act]();
  };

  // settings
  $('#setClose').onclick = () => closeSheet('settings');
  $('#btnExport').onclick = exportBackup;
  $('#btnImport').onclick = () => $('#inImport').click();
  $('#inImport').onchange = e => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; };

  // Android back button closes the top layer
  history.replaceState({ home: 1 }, '');
  history.pushState({ app: 1 }, '');
  addEventListener('popstate', () => {
    const close = topLayerCloser();
    if (!close) { history.back(); return; } // nothing open: let the app exit
    history.pushState({ app: 1 }, '');
    close();
  });

  // shortcuts from the home-screen icon (manifest shortcuts)
  const openId = new URLSearchParams(location.search).get('open');
  if (openId) setTimeout(() => openDetail(openId), 300);
  navigator.serviceWorker?.addEventListener('message', async e => {
    if (e.data?.reload) { S.ideas = (await DB.all('ideas')).map(normalizeIdea); renderList(); if (!$('#detail').hidden && currentId) openDetail(currentId); window.Sync?.schedule(); }
    if (e.data?.open) openDetail(e.data.open);
  });
  const a = new URLSearchParams(location.search).get('a');
  if (a) {
    const presets = { foto: () => $('#inPhoto').click(), voce: startAudio, disegno: openDraw, detta: startDictation };
    setTimeout(() => openComposer(null, presets[a]), 300);
  }
}

function topLayerCloser() {
  if (!$('#recorder').hidden) return () => $('#recCancel').click();
  if (!$('#draw').hidden) return () => { $('#draw').hidden = true; };
  if ($('#dlg').open) return () => $('#dlg').close();
  if ($('#remDlg').open) return () => $('#remCancel').click();
  if (!$('#composer').hidden) return closeComposer;
  for (const s of ['detail', 'cats', 'settings']) if (!$('#' + s).hidden) return () => closeSheet(s);
  return null;
}

/* ---------------- boot ---------------- */
async function seed() {
  const base = [
    ['Store', '#4C7BD9', ['Allestimento', 'Cuneo – nuova apertura']],
    ['Vendite', '#5E9A84', ['Venditori', 'Clienti']],
    ['Marketing', '#EE5D6C', []],
    ['Organizzazione', '#E9A21B', ['Automazioni']],
    ['Personale', '#8C63D6', []],
  ];
  const cats = [];
  for (const [name, color, subs] of base) {
    const id = uid(); cats.push({ id, name, color, parentId: null, createdAt: Date.now() });
    for (const s of subs) cats.push({ id: uid(), name: s, color, parentId: id, createdAt: Date.now() });
  }
  await DB.putMany('cats', cats);
  return cats;
}
(async function boot() {
  icons();
  try { await DB.open(); }
  catch { $('#list').innerHTML = '<div class="empty"><h2>Memoria non disponibile</h2><p>Apri l’app fuori dalla navigazione privata.</p></div>'; return; }
  S.cats = await DB.all('cats');
  S.ideas = (await DB.all('ideas')).map(normalizeIdea);
  if (!S.cats.length && !S.ideas.length && !localStorage.getItem('idee-seeded')) { S.cats = await seed(); try { localStorage.setItem('idee-seeded', '1'); } catch {} }
  bind();
  renderList();
  Reminders.start();
  window.Sync?.init();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
