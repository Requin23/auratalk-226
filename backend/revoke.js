"use strict";

const crypto = require("node:crypto");
const express = require("express");
const http = require("node:http");
const { authenticator } = require("otplib");
const { createClient } = require("redis");
const { Server } = require("socket.io");

const required = [
  "SYNAPSE_URL",
  "SYNAPSE_ADMIN_TOKEN",
  "MATRIX_SERVER_NAME",
  "REDIS_URL",
  "REVOCATION_API_KEY",
  "TOTP_ENCRYPTION_KEY",
];
for (const key of required) {
  if (!process.env[key]) throw new Error("Variable manquante : " + key);
}

const encryptionKey = Buffer.from(process.env.TOTP_ENCRYPTION_KEY, "base64");
if (encryptionKey.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY doit décoder en 32 octets");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
const server = http.createServer(app);
const io = new Server(server, { path: "/socket.io", cors: { origin: false } });
const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", (error) => console.error("Redis :", error.message));

const serverName = process.env.MATRIX_SERVER_NAME;
const synapseUrl = process.env.SYNAPSE_URL.replace(/\/+$/, "");
authenticator.options = { window: 1, step: 30, digits: 6 };

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function decryptSecret(value) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 29) throw new Error("Secret OTP chiffré invalide");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}

function authorize(req, res, next) {
  const provided = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
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
  return "@" + value + ":" + serverName;
}

function localpartFromIdentifier(identifier) {
  if (!identifier || typeof identifier.user !== "string") {
    throw new Error("Identifiant Matrix manquant");
  }
  const value = identifier.user.trim();
  const mxid = value.match(/^@([^:]+):([^:]+)$/);
  if (mxid) {
    if (mxid[2] !== serverName) throw new Error("Serveur Matrix non autorisé");
    return mxid[1];
  }
  if (value.includes("@")) return value.slice(0, value.indexOf("@"));
  return value;
}

// Le MXID de la salle WebSocket est établi à partir du token Matrix vérifié par Synapse.
io.use(async (socket, next) => {
  try {
    const accessToken = socket.handshake.auth && socket.handshake.auth.accessToken;
    if (typeof accessToken !== "string" || accessToken.length < 16) {
      return next(new Error("Authentification requise"));
    }
    const response = await fetch(synapseUrl + "/_matrix/client/v3/account/whoami", {
      headers: { Authorization: "Bearer " + accessToken },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return next(new Error("Session Matrix invalide"));
    const payload = await response.json();
    const userId = payload.user_id;
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
  socket.join("user:" + socket.data.userId);
});

app.post("/admin/agents/:agentId/enroll", authorize, async (req, res) => {
  let userId;
  try {
    userId = asMxid(req.params.agentId);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const password = req.body && req.body.password;
  const displayname = req.body && req.body.displayname;
  if (typeof password !== "string" || password.length < 14 || password.length > 256) {
    return res.status(400).json({ error: "Le mot de passe doit contenir entre 14 et 256 caractères" });
  }

  try {
    const existing = await redis.hGet("agent:" + userId, "status");
    if (existing === "active") {
      return res.status(409).json({ error: "Agent déjà enrôlé" });
    }

    const secret = authenticator.generateSecret();
    const synapseResponse = await fetch(
      synapseUrl + "/_synapse/admin/v2/users/" + encodeURIComponent(userId),
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + process.env.SYNAPSE_ADMIN_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password,
          displayname: typeof displayname === "string" ? displayname.slice(0, 80) : userId.slice(1, userId.indexOf(":")),
          admin: false,
          deactivated: false,
          locked: false,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!synapseResponse.ok) {
      console.error("Synapse refus enrôlement :", synapseResponse.status, await synapseResponse.text());
      return res.status(502).json({ error: "Synapse n’a pas confirmé la création du compte" });
    }

    await redis.hSet("agent:" + userId, {
      status: "active",
      totp_secret: encryptSecret(secret),
      enrolled_at: new Date().toISOString(),
    });

    const label = encodeURIComponent(userId);
    const issuer = encodeURIComponent("AuraTalk-226");
    const otpauth = "otpauth://totp/" + issuer + ":" + label +
      "?secret=" + secret + "&issuer=" + issuer + "&algorithm=SHA1&digits=6&period=30";

    return res.status(201).json({
      enrolled: true,
      userId,
      secret,
      otpauth_url: otpauth,
      warning: "Secret OTP affiché une seule fois : le remettre à l’agent par un canal sûr.",
    });
  } catch (error) {
    console.error("Échec enrôlement :", error.message);
    return res.status(502).json({ error: "Échec de l’enrôlement ; consulter les journaux" });
  }
});

// Element Web transmet le mot de passe dans le formulaire standard. Pour le prototype,
// l'agent saisit mot_de_passe|OTP ; le code OTP ne part jamais à Synapse.
app.post("/matrix/login", async (req, res) => {
  const body = req.body;
  if (!body || body.type !== "m.login.password" || typeof body.password !== "string") {
    return res.status(400).json({ errcode: "M_INVALID_PARAM", error: "Type de connexion non pris en charge" });
  }

  const split = body.password.match(/^([\s\S]+)\|([0-9]{6})$/);
  if (!split) {
    return res.status(401).json({ errcode: "M_FORBIDDEN", error: "Saisir le mot de passe suivi de | puis du code OTP" });
  }

  let userId;
  try {
    userId = asMxid(localpartFromIdentifier(body.identifier));
  } catch {
    return res.status(401).json({ errcode: "M_FORBIDDEN", error: "Identifiants invalides" });
  }

  try {
    const failureKey = "login-fail:" + userId;
    const failures = Number(await redis.get(failureKey) || "0");
    if (failures >= 5) {
      return res.status(429).json({ errcode: "M_LIMIT_EXCEEDED", error: "Trop de tentatives ; réessayer dans cinq minutes" });
    }

    const agent = await redis.hGetAll("agent:" + userId);
    const valid = agent.status === "active" &&
      agent.totp_secret &&
      authenticator.check(split[2], decryptSecret(agent.totp_secret));

    if (!valid) {
      const count = await redis.incr(failureKey);
      if (count === 1) await redis.expire(failureKey, 300);
      return res.status(401).json({ errcode: "M_FORBIDDEN", error: "Identifiants invalides" });
    }

    const upstreamBody = {
      ...body,
      identifier: { type: "m.id.user", user: userId },
      password: split[1],
    };
    const upstream = await fetch(synapseUrl + "/_matrix/client/v3/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(15000),
    });
    const result = await upstream.text();
    if (!upstream.ok) {
      const count = await redis.incr(failureKey);
      if (count === 1) await redis.expire(failureKey, 300);
      return res.status(upstream.status).type("application/json").send(result);
    }

    await redis.del(failureKey);
    const payload = JSON.parse(result);
    if (payload.access_token) {
      const tokenId = crypto.createHash("sha256").update(payload.access_token).digest("hex");
      await redis.sAdd("agent:" + userId + ":tokens", tokenId);
      await redis.set("session:" + tokenId, userId);
    }
    return res.status(upstream.status).type("application/json").send(result);
  } catch (error) {
    console.error("Échec connexion :", error.message);
    return res.status(502).json({ errcode: "M_UNKNOWN", error: "Service de connexion indisponible" });
  }
});

app.post("/admin/agents/:agentId/revoke", authorize, async (req, res) => {
  let userId;
  try {
    userId = asMxid(req.params.agentId);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const response = await fetch(
      synapseUrl + "/_synapse/admin/v1/deactivate/" + encodeURIComponent(userId),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.SYNAPSE_ADMIN_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ erase: false }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) {
      console.error("Synapse refus révocation :", response.status, await response.text());
      return res.status(502).json({ error: "Synapse n’a pas confirmé la désactivation" });
    }

    const tokenIds = await redis.sMembers("agent:" + userId + ":tokens");
    const keys = [
      "agent:" + userId + ":tokens",
      "agent:" + userId + ":session",
      "agent:" + userId,
      ...tokenIds.map((id) => "session:" + id),
    ];
    if (keys.length) await redis.del(keys);

    io.to("user:" + userId).emit("account:revoked", {
      action: "logout-and-clear-local-data",
    });
    io.in("user:" + userId).disconnectSockets(true);

    return res.status(200).json({ revoked: true, userId });
  } catch (error) {
    console.error("Révocation incomplète :", error.message);
    return res.status(502).json({ error: "Échec de révocation ; consulter les journaux" });
  }
});

async function start() {
  await redis.connect();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, "0.0.0.0", () => console.log("API prête sur le port " + port));
}

start().catch((error) => {
  console.error("Démarrage impossible :", error.message);
  process.exit(1);
});