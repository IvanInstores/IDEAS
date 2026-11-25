# Idee — app smartphone per raccogliere idee

PWA (si installa dal browser come un'app, funziona anche offline). Nessun server: i dati restano sul telefono.

## Cosa fa
| Funzione | Come |
|---|---|
| Data e ora | Registrate in automatico all'apertura della nuova idea; se la modifichi resta l'ora originale + "Modificata il…" |
| Categorie e sottocategorie | Livelli illimitati, colore per categoria, filtro a chip in home, ricerca testo |
| Testo | Titolo facoltativo + testo libero |
| Dettatura | Voce → testo (italiano). Chrome Android ok; su iPhone usa il microfono della tastiera |
| Nota audio | Registrazione in-app con timer |
| Disegno | Tela a schermo intero, 7 colori, 4 spessori, annulla |
| Foto / Video | Apre direttamente la fotocamera |
| Galleria | Allega foto, video, audio già presenti sul telefono |
| Modalità miste | Testo + quanti allegati vuoi nella stessa idea |
| Condividi | Invia idea e allegati via WhatsApp, email, Teams… |
| Stato dell'idea | Nuova → In valutazione → In corso → Fatta / Scartata. Ogni cambio è registrato con data e ora. Filtro per stato in home |
| Promemoria | Preset (stasera, domani, lunedì, +1 settimana, +1 mese) o data/ora libera. Banner "da riprendere", notifica all'apertura dell'app, aggiunta a Google Calendar / Outlook / file .ics |
| Sincronizzazione cloud | Dropbox attivo (cartella `/09 - IDEE`). OneDrive/SharePoint e Google Drive predisposti, da attivare |
| Backup | Esporta/importa un file unico |

Scorciatoie: tenendo premuta l'icona dell'app (Android) → Nota vocale, Foto, Disegno.

## Pubblicazione
GitHub Pages in modalità **Deploy from a branch** (`main`, cartella `/ (root)`): ogni modifica su `main` va online da sola in 1–2 minuti.
Indirizzo: https://ivaninstores.github.io/IDEAS/ — da installare sul telefono (Android: ⋮ → Installa app; iPhone/Safari: Condividi → Aggiungi alla schermata Home).

## Sincronizzazione Dropbox
Struttura in `/09 - IDEE`:
- `Elenco idee.md` — elenco leggibile da PC, per categoria, con stato e promemoria (riscritto a ogni sync)
- `Allegati/` — foto, video, audio, disegni con nome `data ora titolo`
- `_app/idee.json` — dati dell'app, **non modificare a mano**

Funzionamento: sincronizza da sola 3 secondi dopo ogni modifica, all'apertura dell'app e al ritorno della rete. Più telefoni con lo stesso Dropbox si uniscono (vince la modifica più recente). Le idee cancellate vengono tolte anche dal cloud.

Collegamento per l'utente: app → ⚙ → *Collega Dropbox* → procedura guidata (scegli cloud → accedi → Consenti → scegli o crea la cartella → prima sincronizzazione).

Configurazione una tantum del proprietario dell'app (vale per tutti gli utenti): creare l'app su https://www.dropbox.com/developers/apps
1. *Create app* → **Scoped access** → **Full Dropbox** → nome es. `Idee Instores`
2. *Permissions*: `files.content.write`, `files.content.read`, `files.metadata.read` → **Submit**
3. *Settings → Redirect URIs*: `https://ivaninstores.github.io/IDEAS/` → **Add**
4. Copiare l'**App key** in `config.js` (`dropboxAppKey`). L'App secret non serve e non va mai inserito.
5. Fino a 500 utenti l'app può restare in stato *Development*; oltre serve *Apply for production*.

OneDrive/SharePoint e Google Drive: richiedono la registrazione dell'app (Microsoft Entra ID / Google Cloud); il motore di sync è già pronto per aggiungerli.

## Notifiche promemoria (anche ad app chiusa)
Server gratuito su **Cloudflare Workers + D1** (`server/`): https://idee-promemoria.idee-instores.workers.dev
- Ogni minuto invia le notifiche dei promemoria scaduti (Web Push, VAPID).
- Sul server ci sono solo: id casuale del dispositivo, id idea, ora, indirizzo push. **Nessun testo delle idee**: la notifica arriva vuota e il telefono la completa con i propri dati.
- Attivazione: app → ⚙ → *Notifiche promemoria* → **Attiva notifiche** (o al primo promemoria). *Invia prova* per verificare.
- Pulsanti nella notifica: **⏰ Rimanda** (1 ora; dopo le 18 → domani alle 9) e **✓ Fatto**, senza aprire l'app.
- Promemoria ricorrenti: ogni giorno, giorni feriali, ogni settimana, ogni 2 settimane, ogni mese. Allo scatto la serie passa alla data successiva e l'idea resta "da riprendere" finché non tocchi Fatto. "Rimanda" su un ricorrente aggiunge un avviso extra senza spostare la serie. Google Calendar e file .ics ricevono anche la ripetizione.
- iPhone: solo con l'app installata sulla schermata Home (iOS 16.4+). I pulsanti nella notifica ci sono su Android; su iPhone si tocca la notifica e si usa Fatto/Rimanda nell'idea.
- Chiave privata VAPID: solo come segreto del Worker (`VAPID_PRIVATE_JWK`), mai nel repository. Chiave pubblica in `config.js`.
- Ripubblicare: `cd server && npx wrangler deploy` (token Cloudflare con permessi Workers + D1 Modifica, salvato nell'ambiente di lavoro).
- Piano gratuito Cloudflare: 100.000 richieste/giorno, cron ogni minuto, D1 500 MB.

## Regole e decisioni
- OneDrive e Google Drive: si attivano solo quando un utente li chiederà (decisione 25/11/2026).
- Nessun riepilogo email settimanale (decisione 25/11/2026).
- Dati sul telefono (IndexedDB) + copia automatica su Dropbox `/09 - IDEE` quando collegato.
- Eliminare una categoria non cancella idee: passano alla categoria superiore; le sottocategorie salgono di livello.
- Categorie iniziali di esempio: Store (Allestimento, Cuneo – nuova apertura), Vendite (Venditori, Clienti), Marketing, Organizzazione (Automazioni), Personale. Modificabili.

## File
`index.html` interfaccia · `styles.css` grafica · `app.js` logica · `sync.js` sincronizzazione cloud · `config.js` chiavi pubbliche · `reminder-core.js` logica promemoria (app + service worker) · `push.js` notifiche · `sw.js` offline · `manifest.webmanifest` installazione · `vendor/lucide.min.js` icone Lucide 0.468
