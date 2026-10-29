# AuraTalk-226

**Prototype de messagerie souveraine pour les agents publics burkinabè**, réalisé par AuraTech (IFOAD / Université Joseph Ki-Zerbo).

## Architecture

- **Synapse / Matrix** : serveur de messagerie ; les clients Element chiffrent les salons E2EE avec les protocoles Matrix.
- **PostgreSQL** : données Synapse.
- **Redis** : sessions applicatives, état d’enrôlement et limitation des tentatives.
- **Element Web** : client web fourni localement.
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
curl -X POST http://localhost:8080/api/admin/agents/agent1/enroll \
  -H "Authorization: Bearer $REVOCATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"password":"REMPLACER_PAR_UN_MOT_DE_PASSE_LONG","displayname":"Agent de démonstration"}'
```

Transmettre le secret TOTP renvoyé une seule fois à l’agent par un canal sûr et l’ajouter à une application OTP. Dans Element, saisir l’identifiant Matrix `agent1` et le mot de passe sous la forme `mot_de_passe|code_OTP`. Le point d’entrée Matrix de connexion est routé par Nginx vers l’API, qui vérifie le code avant de transmettre le mot de passe à Synapse. Les codes OTP ne sont pas envoyés à Synapse.

Révoquer le compte :

```sh
curl -X POST http://localhost:8080/api/admin/agents/agent1/revoke \
  -H "Authorization: Bearer $REVOCATION_API_KEY"
```

La révocation désactive le compte Synapse, révoque ses jetons, supprime son enrôlement OTP et coupe ses sockets actifs. Synapse retire aussi le compte de ses salons et supprime appareils et clés E2EE ; les événements historiques ne sont pas effacés. Un appareil hors ligne ne peut pas recevoir une commande de nettoyage à distance : son cache local ne sera supprimé qu’à sa prochaine reconnexion, et cette purge client reste à implémenter.

## Données et limites du prototype

Dans un salon Matrix chiffré, le serveur stocke les événements chiffrés, mais conserve des métadonnées nécessaires au routage (salons, membres, appareils et horodatages). L’adresse IP peut aussi être traitée par le serveur ou le réseau. Nginx n’enregistre pas les requêtes d’accès dans cette configuration.

**Créer les salons avec le chiffrement activé.** Cette première étape ne force pas encore le chiffrement pour chaque nouveau salon et ne constitue pas une validation de sécurité de production. Le point d’entrée est en HTTP pour la démonstration locale ; ajouter TLS avant tout accès depuis un réseau partagé. L’interface PWA hors ligne et les commandes en Mooré/Dioula restent à réaliser.

Comptes fictifs prévus : `agent1@gouv.bf`, `agent2@gouv.bf`, `revoque@gouv.bf`. Ils ne sont pas créés automatiquement ; seul un compte explicitement enrôlé peut se connecter.

## Licence

Le code de ce dépôt est sous licence **Apache-2.0**. Les composants tiers gardent leurs licences respectives.