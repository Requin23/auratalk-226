# AuraTalk-226 — Note de sécurité

**Équipe :** AuraTech · **Édition :** Sprint Technique Pré-Hackathon 226, 2026  
**Périmètre :** prototype local de messagerie Matrix pour agents fictifs

## Actifs et menaces considérés

Les actifs principaux sont le contenu des messages et fichiers, les identifiants et secrets OTP des agents, les clés de chiffrement Matrix conservées par le client, les sessions actives et les métadonnées des salons. Les menaces considérées sont l’observation du réseau, un serveur curieux ou compromis, la tentative d’accès d’un compte non autorisé, le vol d’un appareil et la perte de contrôle d’un agent qui doit être révoqué.

## Protections implémentées

- **Contenu des échanges :** les salons utilisent Matrix Olm/Megolm via Matrix JS SDK. Les fichiers sont chiffrés côté client avec `matrix-encrypt-attachment` avant dépôt. Le prototype ne met pas en œuvre sa propre cryptographie. Une politique serveur refuse les événements de discussion non chiffrés.
- **Identité et accès :** aucun auto-enrôlement public. L’administrateur crée les agents. La connexion combine mot de passe et OTP TOTP à six chiffres ; l’API vérifie l’OTP avant de transmettre la demande à Synapse. Le compte admin est protégé par une clé locale et un OTP, avec session temporaire.
- **Secrets :** les secrets de déploiement sont générés localement par Compose et stockés dans un volume Docker. Les secrets TOTP conservés par l’API sont chiffrés avec AES-256-GCM et une clé séparée. Les secrets remis une seule fois ne doivent pas être placés dans Git.
- **Révocation :** l’API désactive le compte dans Synapse, retire ses jetons applicatifs connus de Redis et émet un événement WebSocket aux clients connectés. Le client efface ses données de session lorsqu’il reçoit l’ordre.
- **Exposition réseau :** fédération Matrix désactivée ; serveur de clés externe non requis ; journaux d’accès Nginx désactivés afin de réduire la conservation des adresses IP.

## Métadonnées visibles

Le homeserver doit connaître les identifiants Matrix, les salons et leurs membres, les événements de présence/adhésion, les horodatages, les appareils et les informations nécessaires à la synchronisation. Les tailles et certains attributs de fichiers peuvent aussi être déduits. Désactiver la fédération et les journaux d’accès réduit certaines expositions, sans cacher ces métadonnées indispensables au fonctionnement.

## Limites et risques résiduels

1. **Révocation hors ligne :** un appareil entièrement hors ligne ne reçoit pas immédiatement la révocation. Il est bloqué lorsqu’il se reconnecte ; les données déjà copiées, exportées ou déchiffrées ne peuvent pas être supprimées à distance. Cette limite ne satisfait pas complètement l’exigence de révocation immédiate sur tous les appareils.
2. **Stockage local :** les brouillons de texte mis en attente hors ligne restent en clair dans IndexedDB jusqu’à leur envoi. Les pièces jointes en attente sont chiffrées avant stockage. Un appareil ou profil navigateur compromis peut exposer les données déjà consultées.
3. **Transport :** le point d’entrée fourni est en HTTP et destiné à une démonstration sur la machine locale. Un déploiement sur réseau partagé nécessite TLS et une configuration de production revue.
4. **Portée du prototype :** ce projet n’est pas un produit certifié, n’a pas fait l’objet d’un audit indépendant et ne fournit pas encore de commandes vocales, d’interface Mooré/Dioula ni d’archivage légal. Les erreurs applicatives et métadonnées conservées par Matrix restent à protéger par les procédures d’exploitation.

## Vérifications pour la démonstration

Utiliser uniquement des comptes et contenus fictifs. Montrer deux agents, un échange dans un salon chiffré et le résultat visible de la révocation d’un agent connecté. Pour l’épreuve « le serveur ne lit rien », l’équipe doit être prête à expliquer l’événement chiffré dans Synapse et à examiner un test réseau/base de données réalisé dans un environnement local de démonstration. Ne pas présenter une inspection comme effectuée si elle ne l’a pas été.

