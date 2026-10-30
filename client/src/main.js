import * as sdk from "matrix-js-sdk";
import { decryptAttachment, encryptAttachment } from "matrix-encrypt-attachment";
import { io } from "socket.io-client";
import "./styles.css";

const app = document.querySelector("#app");
const AUTH_KEY = "auratalk.auth";
const DB_NAME = "auratalk-local";
let client;
let socket;
let auth;
let adminApiKey = "";
let selectedRoomId = "";
let outbox = [];
let flushing = false;

const shell = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">A</span><div><strong>AuraTalk-226</strong><small>Messagerie souveraine</small></div></div>
    <div class="status"><span id="network-dot"></span><span id="network-label">Connexion…</span><button id="logout" class="quiet hidden">Déconnexion</button></div>
  </header>
  <main id="view"></main>
  <div id="toast" role="status" aria-live="polite"></div>
`;
app.innerHTML = shell;
const view = document.querySelector("#view");
const toast = document.querySelector("#toast");

function notify(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 3500);
}

function setNetwork() {
  const online = navigator.onLine;
  document.querySelector("#network-dot").classList.toggle("offline", !online);
  document.querySelector("#network-label").textContent = online ? "En ligne" : "Hors ligne";
}
window.addEventListener("online", () => { setNetwork(); flushOutbox(); });
window.addEventListener("offline", setNetwork);
setNetwork();

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function listOutbox() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("outbox", "readonly").objectStore("outbox").getAll();
    request.onsuccess = () => resolve(request.result.filter((item) => item.userId === auth?.userId));
    request.onerror = () => reject(request.error);
  });
}

async function putOutbox(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("outbox", "readwrite").objectStore("outbox").put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function removeOutbox(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("outbox", "readwrite").objectStore("outbox").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function clearLocalData() {
  const userId = auth?.userId;
  if (client) {
    try { client.stopClient(); } catch {}
    client = undefined;
  }
  if (socket) {
    socket.disconnect();
    socket = undefined;
  }
  sessionStorage.removeItem(AUTH_KEY);
  if (userId && indexedDB.databases) {
    const databases = await indexedDB.databases();
    const cryptoDbs = databases
      .map((entry) => entry.name)
      .filter((name) => name && name.startsWith("matrix-js-sdk"));
    await Promise.all(cryptoDbs.map((name) => new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    })));
  }
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction("outbox", "readwrite").objectStore("outbox").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  auth = undefined;
  selectedRoomId = "";
  showLogin();
}

function showLogin(message = "") {
  document.querySelector("#logout").classList.add("hidden");
  view.innerHTML = `
    <section class="login-card">
      <div class="eyebrow">Accès réservé aux agents pré-enrôlés</div>
      <h1>Bienvenue sur AuraTalk</h1>
      <p class="muted">La connexion nécessite votre mot de passe et le code de votre application OTP.</p>
      <form id="login-form">
        <label>Identifiant Matrix<input name="user" autocomplete="username" placeholder="agent1" required /></label>
        <label>Mot de passe<input name="password" type="password" autocomplete="current-password" required /></label>
        <label>Code OTP à 6 chiffres<input name="otp" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" required /></label>
        <button class="primary" type="submit">Se connecter</button>
      </form>
      <button id="open-admin" class="quiet admin-entry" type="button">Espace administrateur</button>
      <p id="login-message" class="message"></p>
      <p class="fine">Les salons affichés et créés dans cette interface sont chiffrés de bout en bout. Les brouillons hors ligne sont conservés dans le stockage local du navigateur jusqu’à leur envoi.</p>
    </section>`;
  document.querySelector("#login-message").textContent = message;
  document.querySelector("#login-form").addEventListener("submit", login);
  document.querySelector("#open-admin").addEventListener("click", showAdminLogin);
}

function showAdminLogin(message = "") {
  document.querySelector("#logout").classList.add("hidden");
  view.innerHTML = `
    <section class="login-card admin-card">
      <div class="eyebrow">Espace réservé à l’administration</div>
      <h1>Administration des agents</h1>
      <p class="muted">Saisissez la clé d’administration configurée dans le fichier local .env. Elle reste uniquement en mémoire dans cet onglet.</p>
      <form id="admin-login-form">
        <label>Clé d’administration<input name="key" type="password" autocomplete="off" required /></label>
        <button class="primary" type="submit">Accéder à l’espace admin</button>
      </form>
      <p id="admin-login-message" class="message" role="alert"></p>
      <button id="admin-back" class="quiet" type="button">Retour à la connexion agent</button>
    </section>`;
  document.querySelector("#admin-login-message").textContent = message;
  document.querySelector("#admin-login-form").addEventListener("submit", authenticateAdmin);
  document.querySelector("#admin-back").addEventListener("click", () => { adminApiKey = ""; showLogin(); });
}

async function authenticateAdmin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const key = String(new FormData(form).get("key"));
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(response.status === 401 ? "Clé d’administration invalide." : "Vérification impossible.");
    adminApiKey = key;
    showAdminWorkspace();
  } catch (error) {
    button.disabled = false;
    document.querySelector("#admin-login-message").textContent = error.message || "Accès refusé.";
  }
}

function showAdminWorkspace(result) {
  view.innerHTML = `
    <section class="login-card admin-card admin-wide">
      <div class="admin-title-row"><div><div class="eyebrow">Administration sécurisée</div><h1>Enrôler un agent</h1></div><button id="admin-close" class="quiet" type="button">Fermer la session admin</button></div>
      <p class="muted">Créez un compte réservé aux agents autorisés. L’identifiant et les données d’accès ne seront affichés ici qu’après sa création.</p>
      <form id="enroll-form">
        <label>Identifiant de l’agent<input name="agentId" maxlength="64" pattern="[A-Za-z0-9._=-]+" placeholder="agent1" autocomplete="off" required /></label>
        <label>Nom affiché<input name="displayname" maxlength="80" placeholder="Agent de démonstration" autocomplete="off" /></label>
        <label>Mot de passe provisoire<input name="password" type="password" minlength="14" maxlength="256" autocomplete="new-password" required /></label>
        <p class="fine admin-hint">Choisissez un mot de passe temporaire d’au moins 14 caractères et remettez-le à l’agent par un canal sûr.</p>
        <button class="primary" type="submit">Créer le compte et générer son OTP</button>
      </form>
      <p id="enroll-message" class="message" role="alert"></p>
      <section id="enroll-result" class="enroll-result hidden" aria-live="polite">
        <div class="eyebrow">Compte créé — remise sécurisée requise</div>
        <p>Communiquez ces informations à l’agent. Le secret OTP ne pourra plus être affiché après fermeture de cette page.</p>
        <dl><dt>Identifiant Matrix</dt><dd id="result-id"></dd><dt>Mot de passe provisoire</dt><dd id="result-password"></dd><dt>Secret à ajouter dans une application OTP</dt><dd id="result-otp"></dd></dl>
        <button id="copy-agent-info" class="quiet" type="button">Copier les informations</button>
        <button id="dismiss-agent-info" class="quiet" type="button">Masquer les informations</button>
      </section>
    </section>`;
  document.querySelector("#admin-close").addEventListener("click", () => { adminApiKey = ""; showLogin(); });
  document.querySelector("#enroll-form").addEventListener("submit", enrollAgent);
  if (result) displayEnrollment(result);
}

async function enrollAgent(event) {
  event.preventDefault();
  clearEnrollmentResult();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Création du compte…";
  document.querySelector("#enroll-message").textContent = "";
  try {
    const response = await fetch("/api/admin/agents/" + encodeURIComponent(String(values.agentId).trim()) + "/enroll", {
      method: "POST",
      headers: { Authorization: "Bearer " + adminApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ password: values.password, displayname: values.displayname }),
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Création du compte impossible.");
    displayEnrollment({ ...payload, password: values.password });
    form.reset();
  } catch (error) {
    document.querySelector("#enroll-message").textContent = error.message || "Création du compte impossible.";
  } finally {
    button.disabled = false;
    button.textContent = "Créer le compte et générer son OTP";
  }
}

function displayEnrollment(result) {
  const panel = document.querySelector("#enroll-result");
  document.querySelector("#result-id").textContent = result.userId;
  document.querySelector("#result-password").textContent = result.password;
  document.querySelector("#result-otp").textContent = result.secret;
  panel.classList.remove("hidden");
  document.querySelector("#copy-agent-info").onclick = async () => {
    const details = `Identifiant Matrix: ${result.userId}\nMot de passe provisoire: ${result.password}\nSecret OTP: ${result.secret}`;
    try { await navigator.clipboard.writeText(details); notify("Informations copiées. Remettez-les à l’agent par un canal sûr."); }
    catch { notify("Copie indisponible : sélectionnez les informations affichées."); }
  };
  document.querySelector("#dismiss-agent-info").onclick = () => {
    result.userId = "";
    result.password = "";
    result.secret = "";
    result.otpauth_url = "";
    clearEnrollmentResult();
  };
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearEnrollmentResult() {
  const panel = document.querySelector("#enroll-result");
  if (!panel) return;
  panel.classList.add("hidden");
  panel.querySelectorAll("dd").forEach((item) => { item.textContent = ""; });
  const copy = document.querySelector("#copy-agent-info");
  const dismiss = document.querySelector("#dismiss-agent-info");
  if (copy) copy.onclick = null;
  if (dismiss) dismiss.onclick = null;
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = String(form.get("user")).trim();
  const password = String(form.get("password"));
  const otp = String(form.get("otp")).trim();
  if (!/^[0-9]{6}$/.test(otp)) return showLogin("Le code OTP doit contenir six chiffres.");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Connexion…";
  try {
    const response = await fetch("/_matrix/client/v3/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "m.login.password",
        identifier: { type: "m.id.user", user: username },
        password: password + "|" + otp,
        initial_device_display_name: "AuraTalk PWA",
      }),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Connexion refusée.");
    auth = { accessToken: result.access_token, userId: result.user_id, deviceId: result.device_id };
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    await startMatrix();
  } catch (error) {
    showLogin(error.message || "Connexion impossible.");
  }
}

async function startMatrix() {
  view.innerHTML = `<section class="login-card"><div class="eyebrow">Initialisation sécurisée</div><h1>Ouverture du coffre E2EE…</h1><p class="muted">Ne fermez pas cette fenêtre.</p></section>`;
  try {
    client = sdk.createClient({
      baseUrl: window.location.origin,
      accessToken: auth.accessToken,
      userId: auth.userId,
      deviceId: auth.deviceId,
    });
    // Le SDK Matrix initialise le chiffrement Rust/WebAssembly et son IndexedDB local.
    await client.initRustCrypto();
    registerMatrixListeners();
    socket = io(window.location.origin, {
      path: "/api/socket.io",
      auth: { accessToken: auth.accessToken },
      reconnection: true,
    });
    socket.on("account:revoked", () => {
      void clearLocalData();
      notify("Accès révoqué. Les données locales de cette session ont été supprimées.");
    });
    client.startClient({ initialSyncLimit: 30 });
    showChat();
    await refreshRooms();
    await refreshOutboxCount();
  } catch (error) {
    await clearLocalData();
    showLogin("Le chiffrement Matrix n’a pas pu démarrer : " + (error.message || "erreur inconnue"));
  }
}

function registerMatrixListeners() {
  client.on("Room.timeline", (event, room, toStartOfTimeline) => {
    if (toStartOfTimeline || !room || room.roomId !== selectedRoomId) return;
    void renderTimeline(room);
    void refreshRooms();
  });
  client.on("sync", (state, previous, data) => {
    if (state === "PREPARED" || state === "SYNCING") {
      void refreshRooms();
      if (navigator.onLine) void flushOutbox();
    }
    const errcode = data?.error?.errcode || data?.error?.data?.errcode;
    if (state === "ERROR" && errcode === "M_UNKNOWN_TOKEN") {
      void clearLocalData();
      notify("Session révoquée ou expirée. Reconnectez-vous.");
    }
  });
}

function showChat() {
  document.querySelector("#logout").classList.remove("hidden");
  view.innerHTML = `
    <section class="workspace">
      <aside class="sidebar">
        <div class="sidebar-heading"><div><span class="eyebrow">Vos espaces</span><h2>Salons chiffrés</h2></div><button id="new-room" class="icon-button" aria-label="Créer un salon" title="Créer un salon">+</button></div>
        <p id="outbox-count" class="queue-note">Aucun message en attente</p>
        <nav id="room-list" aria-label="Salons"></nav>
        <form id="room-form" class="room-form hidden">
          <label>Nom du salon<input name="name" maxlength="80" required placeholder="Ex. Équipe projet" /></label>
          <label>Invités (MXID, séparés par des virgules)<textarea name="invites" placeholder="@agent2:matrix.auratalk.local"></textarea></label>
          <button class="primary" type="submit">Créer un salon chiffré</button>
          <button id="cancel-room" type="button" class="quiet">Annuler</button>
        </form>
        <div class="local-note"><strong>Mode hors ligne</strong><span>Les brouillons restent sur cet appareil et partent dès le retour du réseau.</span></div>
      </aside>
      <section class="conversation">
        <div id="empty-state" class="empty-state"><div class="empty-icon">✦</div><h2>Choisissez un salon</h2><p>Les nouveaux salons sont chiffrés dès leur création.</p></div>
        <div id="conversation-content" class="conversation-content hidden">
          <header class="conversation-header"><div><span class="eyebrow">Salon chiffré E2EE</span><h2 id="room-title"></h2></div><span class="lock">🔒</span></header>
          <div id="messages" class="messages" aria-live="polite"></div>
          <form id="message-form" class="composer">
            <textarea name="message" rows="2" maxlength="4000" placeholder="Écrire un message…"></textarea>
            <label class="file-picker">Joindre un fichier<input id="file-input" type="file" multiple /></label>
            <button class="primary" type="submit">Envoyer</button>
          </form>
        </div>
      </section>
    </section>`;
  document.querySelector("#new-room").addEventListener("click", () => document.querySelector("#room-form").classList.remove("hidden"));
  document.querySelector("#cancel-room").addEventListener("click", () => document.querySelector("#room-form").classList.add("hidden"));
  document.querySelector("#room-form").addEventListener("submit", createEncryptedRoom);
  document.querySelector("#message-form").addEventListener("submit", sendMessage);
  document.querySelector("#file-input").addEventListener("change", sendFiles);
  document.querySelector("#logout").onclick = logout;
}

async function encryptedRooms() {
  if (!client) return [];
  const rooms = client.getRooms().filter((room) => room.getMyMembership() === "join");
  const result = [];
  for (const room of rooms) {
    try {
      if (await client.getCrypto().isEncryptionEnabledInRoom(room.roomId)) result.push(room);
    } catch (error) {
      console.error("État de chiffrement du salon indisponible", error);
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

async function refreshRooms() {
  if (!client || !document.querySelector("#room-list")) return;
  const list = document.querySelector("#room-list");
  const rooms = await encryptedRooms();
  list.replaceChildren();
  for (const room of rooms) {
    const button = document.createElement("button");
    button.className = "room-item" + (room.roomId === selectedRoomId ? " selected" : "");
    button.type = "button";
    button.textContent = room.name || room.roomId;
    button.addEventListener("click", () => selectRoom(room.roomId));
    list.append(button);
  }
}

async function selectRoom(roomId) {
  const room = client.getRoom(roomId);
  if (!room || !(await client.getCrypto().isEncryptionEnabledInRoom(roomId))) {
    return notify("Salon non chiffré ou inaccessible : envoi bloqué.");
  }
  selectedRoomId = roomId;
  document.querySelector("#empty-state").classList.add("hidden");
  document.querySelector("#conversation-content").classList.remove("hidden");
  document.querySelector("#room-title").textContent = room.name || roomId;
  await refreshRooms();
  await renderTimeline(room);
}

async function renderTimeline(room) {
  const messages = document.querySelector("#messages");
  if (!messages) return;
  messages.replaceChildren();
  const events = room.getLiveTimeline().getEvents().slice(-100);
  for (const event of events) {
    if (event.getType() !== "m.room.message") continue;
    const content = event.getContent();
    if (!content || typeof content.body !== "string") continue;
    if (content.file?.url) {
      await addEncryptedFile(content, event.getSender() === auth.userId, new Date(event.getTs()));
    } else {
      addMessage(content.body, event.getSender() === auth.userId, new Date(event.getTs()));
    }
  }
  messages.scrollTop = messages.scrollHeight;
}

function addMessage(body, mine, date, pending = false) {
  const messages = document.querySelector("#messages");
  if (!messages) return;
  const item = document.createElement("article");
  item.className = "bubble" + (mine ? " mine" : "") + (pending ? " pending" : "");
  const text = document.createElement("p");
  text.textContent = body;
  const meta = document.createElement("small");
  meta.textContent = (pending ? "En attente · " : "") + date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  item.append(text, meta);
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

async function createEncryptedRoom(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = String(data.get("name")).trim();
  const invite = String(data.get("invites")).split(",").map((value) => value.trim()).filter(Boolean);
  if (invite.some((userId) => !/^@[a-z0-9._=-]+:[a-z0-9.-]+$/i.test(userId))) {
    return notify("Chaque invité doit être un MXID complet, par exemple @agent2:matrix.auratalk.local.");
  }
  try {
    const response = await client.createRoom({
      name,
      invite,
      visibility: "private",
      preset: "private_chat",
      initial_state: [{
        type: "m.room.encryption",
        state_key: "",
        content: { algorithm: "m.megolm.v1.aes-sha2" },
      }],
    });
    form.reset();
    document.querySelector("#room-form").classList.add("hidden");
    notify("Salon privé chiffré créé.");
    await refreshRooms();
    await selectRoom(response.room_id);
  } catch (error) {
    notify(error.message || "Création du salon impossible.");
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.elements.message;
  const body = input.value.trim();
  if (!body) return;
  if (!selectedRoomId) return;
  const room = client.getRoom(selectedRoomId);
  if (!room || !(await client.getCrypto().isEncryptionEnabledInRoom(selectedRoomId))) {
    return notify("Envoi bloqué : ce salon n’est pas chiffré.");
  }
  if (!navigator.onLine) {
    await queueMessage(body);
    form.reset();
    return;
  }
  try {
    await client.sendTextMessage(selectedRoomId, body);
    form.reset();
  } catch (error) {
    if (!navigator.onLine || error?.httpStatus === 0 || error?.name === "NetworkError") {
      await queueMessage(body);
      form.reset();
      return;
    }
    notify(error.message || "Envoi impossible. Le message n’a pas été mis en attente.");
  }
}

async function sendFiles(event) {
  const input = event.currentTarget;
  const files = Array.from(input.files || []);
  if (!files.length) return;
  if (!selectedRoomId) {
    input.value = "";
    return notify("Choisissez un salon chiffré avant de joindre un fichier.");
  }
  if (!navigator.onLine) {
    input.value = "";
    return notify("Les pièces jointes hors ligne ne sont pas encore prises en charge ; le fichier n’a pas été enregistré.");
  }
  const room = client.getRoom(selectedRoomId);
  if (!room || !(await client.getCrypto().isEncryptionEnabledInRoom(selectedRoomId))) {
    input.value = "";
    return notify("Envoi bloqué : ce salon n’est pas chiffré.");
  }
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) {
      notify("Fichier trop volumineux (maximum 20 Mo) : " + file.name);
      continue;
    }
    try {
      const encrypted = await encryptAttachment(await file.arrayBuffer());
      const uploaded = await client.uploadContent(new Blob([encrypted.data], { type: "application/octet-stream" }), {
        type: "application/octet-stream",
        name: file.name,
      });
      const content = {
        msgtype: "m.file",
        body: file.name,
        filename: file.name,
        info: { mimetype: file.type || "application/octet-stream", size: file.size },
        file: { url: uploaded.content_uri, ...encrypted.info },
      };
      await client.sendEvent(selectedRoomId, "m.room.message", content);
    } catch (error) {
      notify("Échec de l’envoi chiffré de " + file.name + " : " + (error.message || "erreur inconnue"));
    }
  }
  input.value = "";
}

async function addEncryptedFile(content, mine, date) {
  const item = document.createElement("article");
  item.className = "bubble" + (mine ? " mine" : "");
  const link = document.createElement("button");
  link.className = "file-download";
  link.type = "button";
  link.textContent = "Télécharger : " + (content.filename || content.body);
  link.addEventListener("click", async () => {
    link.disabled = true;
    try {
      const downloadUrl = client.mxcUrlToHttp(content.file.url);
      if (!downloadUrl) throw new Error("Adresse de média invalide");
      const response = await fetch(downloadUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("Téléchargement refusé");
      const plaintext = await decryptAttachment(await response.arrayBuffer(), content.file);
      const blob = new Blob([plaintext], { type: content.info?.mimetype || "application/octet-stream" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = content.filename || content.body || "fichier";
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      notify("Impossible de déchiffrer le fichier : " + (error.message || "erreur inconnue"));
    } finally {
      link.disabled = false;
    }
  });
  const meta = document.createElement("small");
  meta.textContent = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  item.append(link, meta);
  const messages = document.querySelector("#messages");
  messages?.append(item);
  if (messages) messages.scrollTop = messages.scrollHeight;
}

async function queueMessage(body) {
  const item = {
    id: crypto.randomUUID(),
    userId: auth.userId,
    roomId: selectedRoomId,
    body,
    createdAt: Date.now(),
  };
  await putOutbox(item);
  addMessage(body, true, new Date(item.createdAt), true);
  await refreshOutboxCount();
  navigator.serviceWorker?.ready.then((registration) => registration.sync?.register("auratalk-outbox")).catch(() => {});
  notify("Brouillon enregistré localement ; envoi différé jusqu’au retour du réseau.");
}

async function refreshOutboxCount() {
  if (!auth) return;
  outbox = await listOutbox();
  const label = document.querySelector("#outbox-count");
  if (label) label.textContent = outbox.length
    ? outbox.length + " message(s) en attente sur cet appareil"
    : "Aucun message en attente";
}

async function flushOutbox() {
  if (flushing || !navigator.onLine || !client || !auth) return;
  flushing = true;
  try {
    const pending = await listOutbox();
    for (const item of pending.sort((a, b) => a.createdAt - b.createdAt)) {
      const room = client.getRoom(item.roomId);
      if (!room || !(await client.getCrypto().isEncryptionEnabledInRoom(item.roomId))) continue;
      await client.sendTextMessage(item.roomId, item.body);
      await removeOutbox(item.id);
    }
    await refreshOutboxCount();
    if (pending.length) notify("Messages en attente envoyés dans les salons chiffrés.");
  } catch (error) {
    console.warn("Synchronisation différée reportée :", error.message);
  } finally {
    flushing = false;
  }
}

async function logout() {
  const oldClient = client;
  try {
    if (oldClient && navigator.onLine) await oldClient.logout();
  } catch {}
  await clearLocalData();
  notify("Session fermée et données locales effacées.");
}

async function restoreSession() {
  try {
    const saved = sessionStorage.getItem(AUTH_KEY);
    if (!saved) return showLogin();
    auth = JSON.parse(saved);
    await startMatrix();
  } catch {
    sessionStorage.removeItem(AUTH_KEY);
    showLogin();
  }
}

async function installPwa() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "AURATALK_SYNC_OUTBOX") void flushOutbox();
    });
    if (!sessionStorage.getItem("auratalk.swReload")) {
      sessionStorage.setItem("auratalk.swReload", "1");
      if (navigator.serviceWorker.controller) location.reload();
      else navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    }
    if ("sync" in registration) registration.sync.register("auratalk-outbox").catch(() => {});
  } catch (error) {
    console.warn("Service Worker non disponible :", error.message);
  }
}

document.querySelector("#logout").addEventListener("click", logout);
void installPwa();
void restoreSession();

