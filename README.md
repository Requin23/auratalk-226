# AuraTalk-226

**Prototype de messagerie souveraine pour les agents publics burkinabè**, réalisé par AuraTech (IFOAD / Université Joseph Ki-Zerbo).

## Architecture

- **Synapse / Matrix** : serveur de messagerie ; la PWA AuraTalk chiffre les salons avec les protocoles Matrix.
- **PostgreSQL** : données Synapse.
- **Redis** : sessions applicatives, état d’enrôlement et limitation des tentatives.
- **PWA AuraTalk** : client Matrix JS SDK local avec crypto Rust/WASM, salons chiffrés et file d’envoi hors ligne.
- **Express + Socket.IO** : enrôlement, connexion avec OTP et révocation.
- **Nginx** : point d’entrée local sur le port 8080.

Aucun fournisseur cloud ni service payant n’est requis. Les images Docker doivent toutefois être téléchargées la première fois depuis les registres publics.

## Démarrage

1. Copier `.env.example` vers `.env`.
2. Remplacer les valeurs d’exemple par des secrets générés localement (par exemple `openssl rand -hex 32` pour les secrets hexadécimaux et `openssl rand -base64 32` pour `TOTP_ENCRYPTION_KEY`). Conserver ces secrets hors Git.
3. Lancer :

```sh
docker compose up -d
```

Compose crée le compte d’administration interne Synapse au premier démarrage. Ne pas réutiliser son mot de passe pour les comptes agents.

## Enrôler un agent et se connecter

L’administrateur enrôle uniquement les agents autorisés. Exemple :

```sh
export REVOCATION_API_KEY='REMPLACER_PAR_LA_CLE_DE_VOTRE_FICHIER_ENV'
curl -X POST http://localhost:8080/api/admin/agents/agent1/enroll \
  -H "Authorization: Bearer $REVOCATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"password":"REMPLACER_PAR_UN_MOT_DE_PASSE_LONG","displayname":"Agent de démonstration"}'
```

Transmettre le secret TOTP renvoyé une seule fois à l’agent par un canal sûr et l’ajouter à une application OTP. Dans AuraTalk, saisir l’identifiant Matrix `agent1`, son mot de passe et le code OTP à six chiffres. Le point d’entrée Matrix de connexion est routé par Nginx vers l’API, qui vérifie le code avant de transmettre le mot de passe à Synapse. Les codes OTP ne sont pas envoyés à Synapse.

Révoquer le compte :

```sh
curl -X POST http://localhost:8080/api/admin/agents/agent1/revoke \
  -H "Authorization: Bearer $REVOCATION_API_KEY"
```

La révocation désactive le compte Synapse, révoque ses jetons, supprime son enrôlement OTP et coupe ses sockets actifs. Synapse retire aussi le compte de ses salons et supprime appareils et clés E2EE ; les événements historiques ne sont pas effacés. Un appareil hors ligne ne peut pas recevoir une commande de nettoyage à distance : son cache local ne sera supprimé qu’à sa prochaine reconnexion, ; la PWA efface son coffre local lors de la détection de la révocation au retour en ligne. Les données déjà copiées ou exportées restent hors de son contrôle.

## Données et limites du prototype

Le client initialise la crypto E2EE du SDK Matrix. Les pièces jointes sont chiffrées et déchiffrées avec le module officiel `matrix-encrypt-attachment` ; la taille maximale de démonstration est de 20 Mo. Synapse chiffre par défaut chaque salon local et le module `synapse/encryption_policy.py` refuse les événements de discussion non chiffrés ; les états de salon (noms, membres, adhésions) restent des métadonnées lisibles. Le serveur conserve également les identifiants de salons, appareils et horodatages. L’adresse IP peut être traitée par le serveur ou le réseau. Nginx n’enregistre pas les requêtes d’accès.

Les brouillons texte écrits hors ligne sont conservés en clair dans IndexedDB sur l’appareil jusqu’à leur envoi ; Matrix JS SDK chiffre le message au moment de l’envoi dès que le réseau revient. Les pièces jointes doivent être envoyées en ligne et ne sont pas mises en file d’attente. Protéger les appareils et leur profil navigateur. Un appareil hors ligne ne peut pas recevoir une commande d’effacement à distance : son cache E2EE local sera supprimé au retour en ligne après détection de révocation, mais les brouillons encore hors ligne ne sont pas effaçables à distance. Le point d’entrée est en HTTP pour démonstration locale ; ajouter TLS avant tout accès depuis un réseau partagé. L’interface et les commandes vocales en Mooré/Dioula restent à réaliser. 

Comptes fictifs prévus : `agent1@gouv.bf`, `agent2@gouv.bf`, `revoque@gouv.bf`. Ils ne sont pas créés automatiquement ; seul un compte explicitement enrôlé peut se connecter.

## Licence

Le code de ce dépôt est sous licence **Apache-2.0**. Les composants tiers gardent leurs licences respectives.