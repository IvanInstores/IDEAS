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

Attivazione (una volta): creare un'app su https://www.dropbox.com/developers/apps
1. *Create app* → **Scoped access** → **Full Dropbox** → nome es. `Idee Instores`
2. Scheda *Permissions*: spuntare `files.content.write` e `files.content.read` → **Submit**
3. Scheda *Settings* → *OAuth 2 → Redirect URIs*: aggiungere `https://ivaninstores.github.io/IDEAS/` → **Add**
4. Copiare l'**App key** (non l'App secret) e inserirla in `config.js` oppure incollarla nell'app al primo collegamento
5. App → ⚙ → *Collega Dropbox* → autorizzare

OneDrive/SharePoint e Google Drive: richiedono la registrazione dell'app (Microsoft Entra ID / Google Cloud); il motore di sync è già pronto per aggiungerli.

## Promemoria: limite da sapere
Una web app non può "svegliarsi" da sola a telefono chiuso. Per avere la notifica all'ora esatta usare il pulsante **Google Calendar / Outlook / File calendario** nel dettaglio idea. Dentro l'app i promemoria scaduti compaiono nel banner rosso e come notifica quando la apri.

## Regole e decisioni
- Dati sul telefono (IndexedDB) + copia automatica su Dropbox `/09 - IDEE` quando collegato.
- Eliminare una categoria non cancella idee: passano alla categoria superiore; le sottocategorie salgono di livello.
- Categorie iniziali di esempio: Store (Allestimento, Cuneo – nuova apertura), Vendite (Venditori, Clienti), Marketing, Organizzazione (Automazioni), Personale. Modificabili.

## File
`index.html` interfaccia · `styles.css` grafica · `app.js` logica · `sync.js` sincronizzazione cloud · `config.js` chiavi pubbliche · `sw.js` offline · `manifest.webmanifest` installazione · `vendor/lucide.min.js` icone Lucide 0.468
