Opt-in côté enbauges-go :

1. `cp ../web/materiautheque.html <enbauges-go>/web/pages/materiautheque.html` — la route
   `/materiautheque` est montée automatiquement au démarrage (drop-in pages).
2. Ajouter le lien dans `web/canvas.html`, section « Les services du territoire » :
   `<a href="/materiautheque" class="eb-chip">🧱 Matériauthèque</a>`
3. `./deploy.sh` (binaire + web) puis redémarrer le conteneur `enbauges-go`.
