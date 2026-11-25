# APP «IDEE» — decisioni, regole e stato (25/11/2026)

Scritto il 25/11/2026 su richiesta di Ivan Zulato («salva tutto»). Sessione Claude Code nel repository GitHub `IvanInstores/IDEAS`. Decisioni tutte di **Ivan**, salvo dove indicato.

## 1. Cos'è
App per smartphone (PWA installabile, nessuno store) per raccogliere idee con testo, dettatura, audio, disegni, foto, video, anche mescolati nella stessa idea. Ogni idea registra data e ora di creazione.
- Indirizzo: **https://ivaninstores.github.io/IDEAS/** (installata sul telefono di Ivan).
- Codice: GitHub `IvanInstores/IDEAS` (repository **pubblico**: dentro c'è solo il codice, nessuna idea). Ogni modifica caricata su `main` va online da sola in 1-2 minuti (GitHub Pages «Deploy from a branch», `main`, `/ (root)`).
- Documentazione tecnica completa: `README.md` del repository.

## 2. Funzioni (tutte collaudate da Ivan sul telefono il 25/11)
| Funzione | Dettaglio |
|---|---|
| Categorie e sottocategorie | Livelli illimitati, colore, filtri in home. Eliminare una categoria non cancella idee: passano alla categoria superiore |
| Stati dell'idea | Nuova → In valutazione → In corso → Fatta / Scartata («In corso» aggiunto da Claude, accettato). Ogni cambio con data e ora |
| Promemoria | Preset o data libera; ricorrenti (ogni giorno, feriali, settimana, 2 settimane, mese); banner «da riprendere»; Google Calendar / Outlook / file .ics |
| Notifiche ad app chiusa | Arrivano sul telefono all'ora del promemoria, con pulsanti **⏰ Rimanda** (1 ora; dopo le 18 → domani alle 9) e **✓ Fatto** |
| Vista «Da fare» | Idee In valutazione e In corso: Da riprendere ora / Prossimi promemoria / In corso / In valutazione, filtro per categoria principale, giorni di fermo |
| Sincronizzazione cloud | Dropbox attivo; OneDrive e Google Drive predisposti |
| Backup | Esporta/importa un file unico |

## 3. Decisioni
0. **Il progetto Idee si salva SOLO su GitHub** (questo repository), mai su SharePoint, OneDrive o nell'archivio aziendale (Ivan, 25/11).
1. **Dropbox, cartella `/09 - IDEE`** (Ivan, 25/11). Creata da Claude nel Dropbox personale di Ivan. Dentro: `Elenco idee.md` (leggibile da PC), `Allegati/`, `_app/` (dati dell'app, **non toccare**). Collegamento guidato dentro l'app (⚙ → Collega Dropbox). App Dropbox «Idee Instores» registrata da Ivan, accesso **Dropbox completo**: va bene per Ivan; **da ridiscutere prima di farla usare ad altri** (vedrebbero chiesto l'accesso a tutto il loro Dropbox).
2. **OneDrive e Google Drive**: si attivano **solo quando qualcuno li chiederà** (Ivan, 25/11).
3. **Notifiche**: Supabase scartato da Ivan (nessuna delle 3 opzioni: spazio in «bilancio», progetto a pagamento, pausa di un progetto). Scelto **Cloudflare Workers + D1, piano gratuito, senza carta** (Ivan, 25/11). Server: `https://idee-promemoria.idee-instores.workers.dev`, controllo ogni minuto. Sul server **nessun testo delle idee**: solo id casuale del telefono, id idea, ora, indirizzo di notifica.
4. **Token Cloudflare senza scadenza** (Ivan, 25/11, consigliato da Claude): permessi solo Workers + D1. Salvato nell'ambiente di lavoro Claude Code (non in chat, non nel codice). Si revoca da Cloudflare → Profilo → Token API quando non serve più.
5. **Niente riepilogo email settimanale** (Ivan, 25/11).
6. Prossimi miglioramenti proposti, **non decisi**: «Condividi → Idee» da WhatsApp/galleria/email (solo Android); PDF di una categoria per le riunioni con i soci.

## 4. Account e servizi usati (nessuna password qui)
| Servizio | Account | Uso | Costo |
|---|---|---|---|
| GitHub Pages | IvanInstores | Ospita l'app | 0 € |
| Dropbox | personale di Ivan | Copia delle idee in `/09 - IDEE`; app «Idee Instores» (chiave app pubblica nel codice) | 0 € |
| Cloudflare | personale di Ivan (Gmail) | Server notifiche `idee-promemoria` + database D1 | 0 € (piano gratuito) |

## 5. Limiti da ricordare
- iPhone: notifiche solo con l'app installata sulla schermata Home (iOS 16.4+), senza pulsanti nella notifica.
- La copia principale delle idee è sul telefono; Dropbox è la copia di sicurezza e il modo per averle su un altro telefono.
- Su Samsung il risparmio energetico può ritardare le notifiche (Batteria → Limiti utilizzo in background).
