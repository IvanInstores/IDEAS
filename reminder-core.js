/* Idee — logica dei promemoria condivisa tra app e service worker.
   Campi su un'idea:
     remindAt       prossima scadenza (singola o della serie)
     remindRepeat   null | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly'
     remindDone     promemoria singolo completato
     remindNotified promemoria singolo già notificato
     remindPending  ricorrente scattato e non ancora gestito (resta "da riprendere")
     snoozeUntil    "rimanda" su un ricorrente: notifica extra senza spostare la serie */
'use strict';

const RC = {
  REPEATS: [
    ['', 'Non si ripete'], ['daily', 'Ogni giorno'], ['weekdays', 'Giorni feriali (lun–ven)'],
    ['weekly', 'Ogni settimana'], ['biweekly', 'Ogni 2 settimane'], ['monthly', 'Ogni mese'],
  ],
  repeatLabel(r) { return (RC.REPEATS.find(x => x[0] === (r || '')) || RC.REPEATS[0])[1]; },
  rrule(r) { return ({ daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY' })[r] || ''; },

  step(t, r) {
    const d = new Date(t);
    if (r === 'daily') d.setDate(d.getDate() + 1);
    else if (r === 'weekdays') { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
    else if (r === 'weekly') d.setDate(d.getDate() + 7);
    else if (r === 'biweekly') d.setDate(d.getDate() + 14);
    else if (r === 'monthly') d.setMonth(d.getMonth() + 1);
    else return null;
    return d.getTime();
  },
  next(t, r, now = Date.now()) {
    let x = t, n = 0;
    while (x <= now && n++ < 2000) x = RC.step(x, r);
    return x;
  },

  active(i) { return !!(i.remindAt && !i.remindDone); },
  isDue(i, now = Date.now()) {
    if (i.remindPending) return true;
    return RC.active(i) && !i.remindRepeat && i.remindAt <= now;
  },
  // promemoria che devono scattare adesso (notifica)
  firing(i, now = Date.now()) {
    const out = [];
    if (i.snoozeUntil && i.snoozeUntil <= now) out.push('snooze');
    if (RC.active(i) && i.remindAt <= now && (i.remindRepeat || !i.remindNotified)) out.push('main');
    return out;
  },
  // applica lo scatto: ricorrente → passa alla prossima data e resta "da riprendere"
  fire(i, now = Date.now()) {
    const f = RC.firing(i, now);
    if (!f.length) return false;
    if (f.includes('snooze')) { i.snoozeUntil = null; i.remindPending = true; }
    if (f.includes('main')) {
      if (i.remindRepeat) { i.remindAt = RC.next(i.remindAt, i.remindRepeat, now); i.remindPending = true; }
      else i.remindNotified = true;
    }
    i.updatedAt = now;
    return true;
  },
  // "Fatto": chiude lo scatto attuale (il ricorrente continua)
  done(i, now = Date.now()) {
    i.remindPending = false; i.snoozeUntil = null;
    if (!i.remindRepeat) i.remindDone = true;
    i.updatedAt = now;
  },
  // "Rimanda" a un orario preciso
  snooze(i, ts, now = Date.now()) {
    if (i.remindRepeat) { i.snoozeUntil = ts; i.remindPending = false; }
    else { i.remindAt = ts; i.remindNotified = false; i.remindDone = false; }
    i.updatedAt = now;
  },
  snoozeChoice(now = Date.now()) {
    const d = new Date(now);
    if (d.getHours() < 18) return { label: 'Rimanda 1 ora', ts: now + 3600e3 };
    const t = new Date(now); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0);
    return { label: 'Domani alle 9', ts: t.getTime() };
  },
  notifOptions(i, now = Date.now()) {
    const sn = RC.snoozeChoice(now);
    return {
      body: i.remindRepeat ? 'Promemoria ' + RC.repeatLabel(i.remindRepeat).toLowerCase() : 'È il momento di riprendere questa idea',
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: i.id, renotify: true, vibrate: [120, 60, 120],
      data: { id: i.id },
      actions: [{ action: 'snooze', title: '⏰ ' + sn.label }, { action: 'done', title: '✓ Fatto' }],
    };
  },
  title(i) { return '💡 ' + (i.title || (i.text || '').trim().split('\n')[0].slice(0, 80) || 'Idea'); },
  // elenco per il server: solo id e orari, nessun contenuto
  serverList(ideas, now = Date.now()) {
    const out = [];
    for (const i of ideas) {
      if (RC.active(i) && (i.remindRepeat || !i.remindNotified) && i.remindAt > now - 60000) out.push({ idea: i.id, at: i.remindAt });
      if (i.snoozeUntil && i.snoozeUntil > now - 60000) out.push({ idea: i.id + '~s', at: i.snoozeUntil });
    }
    return out;
  },
};
self.RC = RC;
