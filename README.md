# matériauthèque

La matériauthèque du Cœur des Bauges : matériaux, outils et objets que les habitants
donnent ou prêtent, entre voisins, **sans compte**. Une mini-app opt-in de
[enbauges.fr](https://enbauges.fr) (page servie par [enbauges-go](https://github.com/javimosch/enbauges-go)),
avec [bkn](https://github.com/javimosch/bkn) comme backend et [greffe](https://github.com/javimosch/greffe)
comme registre public infalsifiable.

- **Page** : `web/materiautheque.html`, déposée dans `enbauges-go/web/pages/` (route `/materiautheque`
  automatique — mécanisme « drop-in pages » d'enbauges-go). Vue 3 CDN, style enbauges.
- **Backend** : un seul hook bkn (`bkn/hook.js`) — liste publique, proposition anonyme, modération
  par jeton (`X-Admin-Token`), miroir vers le registre. Deux collections admin-only
  (`materiautheque/items`, `materiautheque/proposals`) ; le hook est la seule surface publique.
- **Registre** : chaque publication, prêt, départ, retrait ou correction est inscrit dans la chaîne
  `coeur-des-bauges` (greffe) via `POST /put`. Deux validateurs (vps1 et mikavm3), chaque nœud refuse
  une réécriture de l'historique établi (`max_reorg`). Servi sous <https://enbauges.fr/registre>
  (explorateur brut : `/registre/ui`). Les contacts n'y figurent jamais.

## Flux

1. Un habitant propose un objet (titre, description, catégorie, commune, don/prêt, contact affiché
   publiquement, photo en lien). Pot de miel anti-robots, limite de débit sur le hook.
2. Un bénévole modère depuis la page même : ouvrir `/materiautheque#admin=<jeton>` une fois
   (le jeton reste dans le navigateur), puis publier / refuser / changer le statut / retirer.
3. Chaque action de modération est inscrite au registre : `materiautheque.item.add`, `.item.lent`,
   `.item.available`, `.item.gone`, `.item.removed`.

## Installation

```sh
cp .env.example .env      # jetons : bkn admin, modération, greffe put_token
# sur la machine qui héberge bkn (ou via docker exec, voir bkn/setup.sh) :
MAT_ADMIN_TOKEN=… REGISTER_URL=https://registre-bauges.vps1.intrane.fr REGISTER_TOKEN=… ./bkn/setup.sh
# preuve sur le système vivant :
BKN_URL=https://bkn.vps1.intrane.fr MAT_ADMIN_TOKEN=… ./bkn/verify.sh
# page + lien dans la nav d'enbauges-go :
cp web/materiautheque.html ../enbauges-go/web/pages/ && (cd ../enbauges-go && ./deploy.sh)
```

## Registre greffe

Validateur sur vps1 (`greffe-bauges.service`, données `/root/.greffe-bauges`, port 7421,
`--ui --put-token --base-path /registre`, route Traefik `enbauges.fr/registre`), second validateur sur
mikavm3 (port 7421, aussi relais). Genèse dans `greffe/genesis.json`. Honnêteté : les deux clés sont
aujourd'hui tenues par l'équipe d'enbauges ; la garantie devient complète quand une association du
territoire tient la seconde clé sur sa machine (`greffe grant validator <pub>`).

## Suite de vérification et registre réel

`bkn/verify.sh` joue le cycle complet (proposition → publication → modération → statut) sur le bkn
vivant. Ses actions admin portent `"register":"skip"` : le hook répond `{skipped}` et n'écrit rien
au registre réel, qui n'oublie pas. Les trois « Tuiles terre cuite (verify) » présents dans le
registre datent d'avant cette règle ; ils y restent, retirés, et l'onglet Registre masque les objets
retirés par défaut.

## Décisions

- **bkn plutôt qu'un plugin Go** : zéro code serveur à redéployer ; le backend entier est un hook,
  deux collections et des réglages kv, installables et vérifiables depuis la CLI.
- **Le contact est public par choix de l'annonceur** (comme une petite annonce) : pas de messagerie,
  pas de compte, pas de donnée cachée sur le serveur.
- **Registre séparé du catalogue** : bkn tient l'état consultable et les photos ; greffe tient
  l'historique que personne ne peut réécrire. Si greffe est indisponible, le catalogue continue
  et l'inscription est signalée en événement `register.failed`.
