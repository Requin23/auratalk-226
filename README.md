# AuraTalk-226

Prototype de messagerie souveraine pour les agents publics burkinabè, développé par AuraTech (IFOAD / Université Joseph Ki-Zerbo) pour le Sprint Technique Pré-Hackathon 226, édition 2026.

## Concept et architecture

AuraTalk permet aux agents pré-enrôlés d’échanger des messages, des fichiers et des salons de groupe chiffrés. Le chiffrement s’appuie sur Matrix Olm/Megolm via le Matrix JS SDK ; aucun algorithme cryptographique n’est développé par l’équipe.

- **Synapse / Matrix** : homeserver et synchronisation des conversations.
- **PostgreSQL** : stockage Synapse.
- **Redis** : sessions, enrôlement OTP et état de révocation.
- **API Node.js / Express / Socket.IO** : enrôlement, contrôle OTP, administration et déconnexion des appareils connectés.
- **Client PWA JavaScript** : crypto Matrix, notifications, messages et pièces jointes chiffrés, compteurs de non-lus et file d’envoi locale.
- **Nginx** : point d’entrée local sur le port 8080.

Le code AuraTalk est sous Apache-2.0. Les composants et leurs licences sont répertoriés dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). L’équipe choisit l’engagement open source **Créer** : réaliser un client nouveau au-dessus de protocoles et bibliothèques éprouvés.

## Démarrage

Depuis le dossier du dépôt, lancer :

```sh
docker compose up -d
```

Au premier démarrage, Docker Compose génère les secrets locaux dans un volume Docker. Les images doivent être téléchargées depuis les registres publics lors de l’installation initiale ; aucun service cloud ni API externe n’est nécessaire au fonctionnement une fois installé. La fédération Matrix est désactivée.

Pour récupérer la clé d’accès admin dans PowerShell, sans l’afficher dans le terminal :

```powershell
docker compose run --rm --no-deps --entrypoint cat secrets-init /run/auratalk-secrets/revocation_api_key | Set-Clipboard
```

Ouvrir `http://localhost:8080`, choisir **Espace administrateur** et coller la clé. À la première ouverture, configurer le second facteur admin avec une application OTP. L’admin enrôle les comptes autorisés ; chaque agent reçoit un identifiant, un mot de passe provisoire et un secret OTP à remettre par un canal sûr. À la connexion, l’agent saisit son identifiant, son mot de passe et le code OTP à six chiffres.

## Démonstration

Comptes fictifs prévus : `agent1@gouv.bf`, `agent2@gouv.bf` et `revoque@gouv.bf`. Ils ne sont pas créés automatiquement. L’administrateur doit les enrôler. Ne pas publier de mots de passe, secrets OTP ni clé admin dans le dépôt.

Dans deux sessions navigateur, connecter deux agents, créer un salon chiffré en invitant le MXID complet de l’autre agent, puis échanger des messages. Les événements se synchronisent en temps réel ; les salons affichent un compteur de non-lus. Les pièces jointes sont chiffrées côté client et se téléchargent depuis la conversation. Hors ligne, les pièces jointes sont chiffrées avant la mise en file ; les brouillons texte restent en clair dans le stockage local jusqu’à leur envoi.

Depuis **Révoquer un agent** dans l’espace admin, saisir `agent1` ou son MXID complet et confirmer. Synapse désactive le compte ; les sessions applicatives sont invalidées et les appareils connectés reçoivent une déconnexion. Un appareil hors ligne ne peut recevoir cette révocation qu’à sa reconnexion.

## Sécurité et limites

Le serveur stocke des événements chiffrés et des métadonnées nécessaires : identifiants des agents et salons, membres, appareils, horodatages et informations techniques. La fédération est désactivée et les journaux d’accès Nginx sont coupés pour limiter les traces IP. Les états de salon et les erreurs restent visibles ou enregistrés. Le texte des brouillons hors ligne est conservé en clair dans IndexedDB.

L’URL est en HTTP pour une démonstration locale ; ne pas exposer le prototype sur un réseau partagé sans TLS. La révocation ne peut pas effacer à distance un cache hors ligne, ni des données déjà copiées ou déchiffrées. Le prototype ne fournit pas encore d’interface Mooré/Dioula, commandes vocales ni archivage légal. La note de sécurité détaillée se trouve dans `DOSSIER/note-securite.md`.


