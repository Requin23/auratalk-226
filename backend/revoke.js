"use strict";

const crypto = require("node:crypto");
const express = require("express");
const http = require("node:http");
const { createClient } = require("redis");
const { Server } = require("socket.io");

const required = [
  "SYNAPSE_URL",
  "SYNAPSE_ADMIN_TOKEN",
  "MATRIX_SERVER_NAME",
  "REDIS_URL",
  "REVOCATION_API_KEY",
];
for (const key of required) {
  if (!process.env[key]) throw new Error(\`Variable manquante : \${key}\`);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", (error) => console.error("Redis :", error.message));

const serverName = process.env.MATRIX_SERVER_NAME;
const synapseUrl = process.env.SYNAPSE_URL.replace(/\\/+$/, "");

// Le MXID est vérifié par Synapse ; il n'est jamais fourni librement par le navigateur.
io.use(async (socket, next) => {
  try {
    const accessToken = socket.handshake.auth?.accessToken;
    if (typeof accessToken !== "string" || accessToken.length < 16) {
      return next(new Error("Authentification requise"));
    }
    const response = await fetch(\`\${synapseUrl}/_matrix/client/v3/account/whoami\`, {
      headers: { Authorization: \`Bearer \${accessToken}\` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return next(new Error("Session Matrix invalide"));
    const { user_id: userId } = await response.json();
    if (!userId || userId.slice(userId.lastIndexOf(":") + 1) !== serverName) {
      return next(new Error("Compte Matrix non autorisé"));
    }
    socket.data.userId = userId;
    next();
  } catch {
    next(new Error("Authentification indisponible"));
  }
});

io.on("connection", (socket) => {
  socket.join(\`user:\${socket.data.userId}\`);
});

function authorize(req, res, next) {
  const provided = (req.get("authorization") || "").replace(/^Bearer\\s+/i, "");
  const expected = process.env.REVOCATION_API_KEY;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  next();
}

function asMxid(value) {
  if (/^@[a-z0-9._=-]+:[a-z0-9.-]+$/i.test(value)) {
    if (value.slice(value.lastIndexOf(":") + 1) !== serverName) {
      throw new Error("Le compte doit être hébergé sur ce serveur");
    }
    return value;
  }
  if (!/^[a-z0-9._=-]{1,64}$/i.test(value)) {
    throw new Error("Identifiant d’agent invalide");
  }
  return \`@\${value}:\${serverName}\`;
}

app.post("/admin/agents/:agentId/revoke", authorize, async (req, res) => {
  let userId;
  try {
    userId = asMxid(req.params.agentId);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const response = await fetch(
      \`\${synapseUrl}/_synapse/admin/v1/deactivate/\${encodeURIComponent(userId)}\`,
      {
        method: "POST",
        headers: {
          Authorization: \`Bearer \${process.env.SYNAPSE_ADMIN_TOKEN}\`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ erase: false }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) {
      console.error("Synapse refus révocation :", response.status, await response.text());
      return res.status(502).json({ error: "Synapse n’a pas confirmé la désactivation" });
    }

    // L'API d'enrôlement doit inscrire chaque identifiant opaque dans cet ensemble Redis.
    const tokenIds = await redis.sMembers(\`agent:\${userId}:tokens\`);
    const keys = [
      \`agent:\${userId}:tokens\`,
      \`agent:\${userId}:session\`,
      ...tokenIds.map((id) => \`session:\${id}\`),
    ];
    if (keys.length) await redis.del(keys);

    io.to(\`user:\${userId}\`).emit("account:revoked", {
      action: "logout-and-clear-local-data",
    });
    io.in(\`user:\${userId}\`).disconnectSockets(true);

    return res.status(200).json({ revoked: true, userId });
  } catch (error) {
    console.error("Révocation incomplète :", error.message);
    return res.status(502).json({ error: "Échec de révocation ; consulter les journaux" });
  }
});

async function start() {
  await redis.connect();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, "0.0.0.0", () => console.log(\`API prête sur le port \${port}\`));
}

start().catch((error) => {
  console.error("Démarrage impossible :", error.message);
  process.exit(1);
});