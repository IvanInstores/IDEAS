// Configurazione pubblica dell'app (nessun segreto: con OAuth PKCE la "App key" Dropbox può stare qui).
self.IDEE_CONFIG = {
  dropboxAppKey: '55z841l2zpkn5z8',
  // server promemoria (server/worker.js su Cloudflare) e chiave pubblica VAPID
  pushServer: 'https://idee-promemoria.idee-instores.workers.dev',
  vapidPublic: 'BMmie1ejDqQPMUf-NFxOo1U-ekMxr_fe0DtC1LO5uVoCWdpoE55JGDsOWP6hUg2s_z13l6c3Rvp9JPGICkzaDmI',
};
