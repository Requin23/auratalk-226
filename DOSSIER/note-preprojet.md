# AuraTalk-226 — Note de pré-projet

**Équipe :** AuraTech · **Établissement :** IFOAD / Université Joseph Ki-Zerbo  
**Challenge :** messagerie souveraine de l’administration · **Édition :** 2026

## Concept

AuraTalk-226 est un prototype de messagerie instantanée pour des agents publics préalablement autorisés. Il permet des échanges individuels et en groupe, le partage de fichiers et une utilisation en connectivité intermittente. Le projet vise un déploiement local sous le contrôle de l’organisation hébergeuse, sans dépendance à un service cloud ni à une API tierce pendant l’utilisation.

## Architecture et chiffrement

Le déploiement réunit Synapse (homeserver Matrix), PostgreSQL, Redis, une API Node.js / Express / Socket.IO, un client PWA JavaScript et Nginx. Docker Compose permet de lancer la pile avec `docker compose up -d`. Les services communiquent sur un réseau Docker local.

Le client s’appuie sur Matrix JS SDK et le protocole Olm/Megolm pour le chiffrement de bout en bout des salons. Les pièces jointes sont chiffrées côté client avec `matrix-encrypt-attachment` avant leur dépôt dans le stockage média Matrix. Aucun chiffrement maison n’est ajouté. Le serveur conserve les événements chiffrés et les métadonnées nécessaires au routage et à la synchronisation.

Les comptes sont créés par l’administration, pas par inscription publique. La connexion des agents exige un mot de passe et un code OTP TOTP. L’administration utilise une clé locale et un OTP. La révocation désactive le compte Synapse, invalide les sessions suivies par l’API et déconnecte les appareils connectés par WebSocket.

## Fonctionnalités présentées

- Salons chiffrés, messages synchronisés en temps réel et fichiers chiffrés téléchargeables.
- Alertes de réception et compteur de messages non lus par salon.
- File d’attente locale pour l’envoi différé après retour du réseau ; les pièces jointes sont chiffrées avant mise en file.
- Espace d’administration pour enrôler et révoquer les agents.

L’interface Mooré/Dioula et les commandes vocales sont des pistes d’évolution, pas des fonctionnalités intégrées dans la version présentée. La fonctionnalité innovante retenue pour la démonstration est le repérage des salons avec messages non lus, en complément des échanges en temps réel.

## Engagement open source

L’équipe choisit **Créer** : un client PWA nouveau reposant sur Matrix et des bibliothèques éprouvées. Le code AuraTalk est publié sous Apache-2.0. Les composants, versions et licences principales sont inventoriés dans `THIRD_PARTY_NOTICES.md`. Les licences amont de Synapse et des dépendances sont conservées.

## Répartition des rôles

| Membre | Profil | Contribution principale |
|---|---|---|
| Membre 1 — nom à compléter | Génie logiciel | Client PWA, salons et interface |
| Membre 2 — nom à compléter | Génie logiciel | API d’enrôlement / révocation, intégration et documentation |
| Membre 3 — nom à compléter | Réseaux & systèmes | Compose, Synapse, base de données, réseau et déploiement |

Cette répartition est à confirmer par l’équipe et à faire correspondre à ses contributions réelles.

