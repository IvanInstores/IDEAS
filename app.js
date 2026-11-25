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
      const r = indexedDB.open('idee-db', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('ideas', { keyPath: 'id' });
        d.createObjectStore('cats', { keyPath: 'id' });
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
};

/* ---------------- state ---------------- */
const S = { ideas: [], cats: [], filter: null, q: '', urls: [] };

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
}
function rootOf(id) { let c = catById(id), g = 0; while (c?.parentId && g++ < 20) c = catById(c.parentId); return c?.id; }

function filteredIdeas() {
  let list = S.ideas;
  if (S.filter) { const set = descendants(S.filter); list = list.filter(i => set.has(i.catId)); }
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
      <p>${none ? 'Tocca il cubo giallo e scrivi, detta, disegna, fotografa o registra.' : 'Prova un’altra categoria o un’altra parola.'}</p></div>`;
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
      <span class="catline">${i.catId ? `<span class="dot" style="--c:${col}"></span>${esc(catPath(i.catId))}` : 'Senza categoria'}</span>
      <h4>${esc(title)}</h4>
      ${body ? `<p>${esc(body)}</p>` : ''}
      ${imgs.length || counts.length ? `<span class="media-strip">
        ${imgs.map(b => `<img class="thumb" alt="" src="${track(URL.createObjectURL(b.blob))}">`).join('')}
        ${counts.map(([ic, n]) => `<span class="mtag"><i data-lucide="${ic}"></i>${n}</span>`).join('')}
      </span>` : ''}
    </button>`;
  }
  main.innerHTML = html;
  icons();
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
    : { id: uid(), createdAt: Date.now(), title: '', text: '', catId: S.filter || null, blocks: [] };
  $('#cmpTitle').value = draft.title;
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
  if (!draft.title && !draft.text && !draft.blocks.length) { toast('Aggiungi almeno un testo o un contenuto'); return; }
  if (editingId) draft.updatedAt = Date.now();
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
    <div class="det-media">${i.blocks.map(b => {
      const u = URL.createObjectURL(b.blob);
      return b.type === 'video' ? `<video src="${u}" data-url="${u}" controls playsinline preload="metadata"></video>`
        : b.type === 'audio' ? `<audio src="${u}" data-url="${u}" controls preload="metadata"></audio>`
        : `<img src="${u}" data-url="${u}" alt="${b.type === 'drawing' ? 'Disegno' : 'Foto'}">`;
    }).join('')}</div>
    <p class="det-meta">Creata ${esc(fmtFull(i.createdAt))}${i.updatedAt ? `<br>Modificata ${esc(fmtFull(i.updatedAt))}` : ''}</p>`;
  $('#toast').classList.remove('show');
  openSheet('detail'); icons();
}
async function deleteCurrent() {
  const r = await ask({ title: 'Eliminare questa idea?', msg: 'Verranno eliminati anche foto, video, audio e disegni collegati.', okText: 'Elimina', input: false });
  if (!r) return;
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
  const c = { id: uid(), name: r.value, color: r.color, parentId: parentId || null, createdAt: Date.now() };
  await DB.put('cats', c); S.cats.push(c);
  renderTree(); renderList(); return c;
}
async function editCat(id) {
  const c = catById(id);
  const r = await ask({ title: 'Rinomina categoria', value: c.name, color: c.color });
  if (!r) return;
  c.name = r.value; c.color = r.color; await DB.put('cats', c);
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
  const movedIdeas = S.ideas.filter(i => i.catId === id); movedIdeas.forEach(i => i.catId = c.parentId || null);
  kids.forEach(k => k.parentId = c.parentId || null);
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
    S.cats.push(...cats); S.ideas.push(...ideas);
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
  $('#btnSearch').onclick = () => { $('#searchbar').hidden = false; $('#q').focus(); };
  $('#btnSearchClose').onclick = () => { $('#searchbar').hidden = true; $('#q').value = ''; S.q = ''; renderList(); };
  $('#q').oninput = e => { S.q = e.target.value.trim(); renderList(); };
  $('#btnCats').onclick = () => { renderTree(); openSheet('cats'); };
  $('#btnSettings').onclick = () => { renderStorage(); openSheet('settings'); };

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
  S.ideas = await DB.all('ideas');
  if (!S.cats.length && !S.ideas.length && !localStorage.getItem('idee-seeded')) { S.cats = await seed(); try { localStorage.setItem('idee-seeded', '1'); } catch {} }
  bind();
  renderList();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
