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
| Backup | Esporta/importa un file unico (salvalo su OneDrive/Dropbox) |

Scorciatoie: tenendo premuta l'icona dell'app (Android) → Nota vocale, Foto, Disegno.

## Pubblicazione (una volta sola)
1. Unire questo branch su `main`.
2. GitHub → repo → **Settings → Pages → Source: GitHub Actions**.
3. Il workflow `.github/workflows/pages.yml` pubblica l'app all'indirizzo `https://<utente>.github.io/IDEAS/`.
4. Sul telefono: apri il link → Android/Chrome: menu ⋮ → *Installa app*; iPhone/Safari: Condividi → *Aggiungi alla schermata Home*.

Serve HTTPS (GitHub Pages lo dà) perché microfono e fotocamera funzionino.

## Regole e decisioni
- Dati solo in locale (IndexedDB) → **fare backup periodico**.
- Eliminare una categoria non cancella idee: passano alla categoria superiore; le sottocategorie salgono di livello.
- Categorie iniziali di esempio: Store (Allestimento, Cuneo – nuova apertura), Vendite (Venditori, Clienti), Marketing, Organizzazione (Automazioni), Personale. Modificabili.

## File
`index.html` interfaccia · `styles.css` grafica · `app.js` logica · `sw.js` offline · `manifest.webmanifest` installazione · `vendor/lucide.min.js` icone Lucide 0.468
