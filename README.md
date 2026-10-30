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

Lancer la pile depuis le dossier du dépôt :

```sh
docker compose up -d
```

Au premier démarrage, Compose génère les secrets aléatoires nécessaires et les conserve dans un volume Docker local. Un fichier `.env` n’est nécessaire que pour personnaliser `MATRIX_SERVER_NAME` avant la première création du serveur. Les images Docker et paquets doivent être obtenus la première fois depuis des registres publics; l’application ne dépend d’aucun service cloud/API tiers pour fonctionner une fois lancée. La fédération Matrix est désactivée.

Compose crée aussi le compte d’administration interne Synapse. La clé d’accès à l’espace admin peut être copiée dans le presse-papiers sous PowerShell avec :

```powershell
docker compose run --rm --no-deps --entrypoint cat secrets-init /run/auratalk-secrets/revocation_api_key | Set-Clipboard
```

Au premier accès admin, saisir cette clé : l’interface génère alors un secret OTP à enregistrer dans une application d’authentification. La clé et le code OTP seront requis aux connexions suivantes. Le secret OTP n’est affiché qu’une fois; le conserver dans un gestionnaire de secrets. Le volume `bootstrap_secrets` contient les secrets générés : le sauvegarder avec les autres données persistantes.

## Enrôler un agent et se connecter

Dans la page AuraTalk, choisir **Espace administrateur**, saisir la clé copiée depuis le volume Docker puis le code OTP. La clé est conservée seulement en mémoire pendant l’authentification; les actions suivantes utilisent une session admin limitée à 15 minutes. L’administrateur choisit l’identifiant, le nom affiché et un mot de passe provisoire (14 caractères minimum). Après création, l’écran admin affiche l’identifiant Matrix, le mot de passe et le secret OTP une seule fois pour remise à l’agent.

L’espace est protégé par une clé de déploiement partagée plus OTP, pas par une identité administrative nominative. Utiliser uniquement sur un ordinateur local de confiance; le point d’entrée reste en HTTP local.

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

Les brouillons texte écrits hors ligne sont conservés en clair dans IndexedDB sur l’appareil jusqu’à leur envoi ; Matrix JS SDK chiffre le message au moment de l’envoi dès que le réseau revient. Les pièces jointes sont chiffrées par le module Matrix officiel avant d’être mises en file d’attente locale; taille maximale de démonstration : 20 Mo. Protéger les appareils et leur profil navigateur. Synapse invalide les sessions et retire l’agent de ses salons lors de la révocation. Les clients connectés reçoivent aussi l’ordre de fermeture par WebSocket. Un appareil entièrement hors ligne ne peut recevoir une révocation ni un ordre d’effacement tant qu’il n’a pas de réseau; le cache local qui a déjà été copié ou déchiffré n’est pas récupérable à distance. Les journaux de requêtes HTTP Synapse sont désactivés pour limiter la conservation des IP; les erreurs applicatives et métadonnées Matrix persistées demeurent. Le point d’entrée est en HTTP pour démonstration locale; ajouter TLS avant tout accès depuis un réseau partagé. Les textes d’interface Mooré/Dioula restent à faire valider et implémenter. Aucun modèle de reconnaissance vocale Mooré/Dioula permissivement licencié et intégré hors-ligne n’est livré dans ce prototype.

Comptes fictifs prévus : `agent1@gouv.bf`, `agent2@gouv.bf`, `revoque@gouv.bf`. Ils ne sont pas créés automatiquement ; seul un compte explicitement enrôlé peut se connecter.

## Licence

Le code de ce dépôt est sous licence **Apache-2.0**. Voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) pour les licences des principaux composants; les dépendances transitives conservent leurs licences respectives.

