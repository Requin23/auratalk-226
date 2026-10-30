# Licences des composants tiers

Le code AuraTalk-226 est distribué sous Apache-2.0. Les composants tiers ci-dessous conservent leurs licences propres; cette liste résume les composants directement utilisés et les images de la pile. Les distributions Node.js et Alpine contiennent aussi des dépendances transitives avec leurs propres avis de licence.

| Composant | Utilisation | Licence |
|---|---|---|
| Synapse | Homeserver Matrix | AGPL-3.0 |
| matrix-js-sdk | Client Matrix et crypto E2EE | Apache-2.0 |
| matrix-encrypt-attachment | Chiffrement des pièces jointes | Apache-2.0 |
| Express | API d’enrôlement et de révocation | MIT |
| otplib | Validation OTP | MIT |
| node-redis | Client Redis-compatible pour Node.js | MIT |
| Socket.IO / socket.io-client | Signal de révocation en direct | MIT |
| Redis 7.2 | Cache, sessions et révocations | BSD-3-Clause |
| PostgreSQL | Stockage Synapse | PostgreSQL License |
| Nginx | Reverse proxy local | BSD-2-Clause |
| Node.js | Runtime API et compilation PWA | MIT |
| Vite | Compilation de la PWA | MIT |
| PostgreSQL/Synapse/Nginx/Node/Alpine images | Images conteneurs | Licences propres à chaque distribution et paquet |

Les notices et textes de licence sont publiés par les projets concernés. Redis est fixé à la branche 7.2, qui reste sous BSD-3-Clause; ne pas remplacer par Redis 7.4+ sans réexaminer les conditions de licence. Voir [licences Redis](https://redis.io/legal/licenses/).

