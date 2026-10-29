// Planning Poker Fibonacci — serveur HTTP + WebSocket
// Les votes restent sur le serveur et ne sont envoyés aux navigateurs qu'après la révélation.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("./websocket");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const VALUES = ["0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "?"];
const FIB = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // une salle vide est supprimée après 6 h

// ---------- Fichiers statiques ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/health") { res.writeHead(200); return res.end("ok"); }
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Introuvable"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
});

// ---------- Salles ----------
/** room = { id, ticket, round, revealed, history[], players: Map<playerId,{name,vote,sockets:Set}>, emptySince } */
const rooms = new Map();

function getRoom(id) {
  let r = rooms.get(id);
  if (!r) {
    r = { id, ticket: "", round: 1, revealed: false, history: [], players: new Map(), emptySince: null };
    rooms.set(id, r);
  }
  return r;
}

function summarize(room) {
  const nums = [...room.players.values()].map(p => p.vote).filter(v => v != null && v !== "?").map(Number);
  if (!nums.length) return null;
  const s = nums.sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const suggest = FIB.reduce((a, b) => (Math.abs(b - avg) < Math.abs(a - avg) ? b : a));
  return { n: s.length, avg: Math.round(avg * 10) / 10, med, min: s[0], max: s[s.length - 1], suggest, consensus: s[0] === s[s.length - 1] };
}

function publicState(room) {
  const players = [];
  for (const [id, p] of room.players) {
    const online = p.sockets.size > 0;
    if (!online && p.vote == null) continue; // les absents sans vote disparaissent de la table
    players.push({ id, name: p.name, online, voted: p.vote != null, value: room.revealed ? p.vote : null });
  }
  return {
    type: "state",
    room: room.id,
    ticket: room.ticket,
    round: room.round,
    revealed: room.revealed,
    players,
    summary: room.revealed ? summarize(room) : null,
    history: room.history,
  };
}

function broadcast(room) {
  const msg = JSON.stringify(publicState(room));
  for (const p of room.players.values()) for (const ws of p.sockets) if (ws.readyState === 1) ws.send(msg);
}

const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
const validRoom = s => /^[a-z0-9-]{3,40}$/i.test(s);
const validId = s => /^[a-z0-9-]{8,64}$/i.test(s);

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });

wss.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  let room = null, playerId = null;

  ws.on("message", raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === "join") {
      if (room || !validRoom(m.room) || !validId(m.playerId)) return;
      room = getRoom(m.room.toLowerCase());
      playerId = m.playerId;
      const name = clean(m.name, 30) || "Participant";
      let p = room.players.get(playerId);
      if (!p) { p = { name, vote: null, sockets: new Set() }; room.players.set(playerId, p); }
      p.name = name;
      p.sockets.add(ws);
      room.emptySince = null;
      ws.send(JSON.stringify({ type: "welcome", playerId, vote: p.vote }));
      return broadcast(room);
    }
    if (!room) return;
    const me = room.players.get(playerId);

    switch (m.type) {
      case "vote":
        if (room.revealed) return;
        if (m.value === null) me.vote = null;
        else if (VALUES.includes(String(m.value))) me.vote = String(m.value);
        else return;
        break;
      case "rename":
        me.name = clean(m.name, 30) || me.name;
        break;
      case "ticket":
        room.ticket = clean(m.ticket, 140);
        break;
      case "reveal":
        if (![...room.players.values()].some(p => p.vote != null)) return;
        room.revealed = true;
        break;
      case "next": {
        // Archive le résultat si les cartes étaient révélées, puis démarre un nouveau tour
        if (room.revealed) {
          const s = summarize(room);
          room.history.push({ ticket: room.ticket, round: room.round, ...(s || { n: 0 }) });
          room.history = room.history.slice(-50);
          room.ticket = "";
        }
        room.round += 1;
        room.revealed = false;
        for (const p of room.players.values()) p.vote = null;
        break;
      }
      default:
        return;
    }
    broadcast(room);
  });

  ws.on("close", () => {
    if (!room) return;
    const p = room.players.get(playerId);
    if (p) p.sockets.delete(ws);
    if ([...room.players.values()].every(x => x.sockets.size === 0)) room.emptySince = Date.now();
    broadcast(room);
  });
});

// Ping régulier : garde les connexions ouvertes derrière les proxys des hébergeurs
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [id, r] of rooms) if (r.emptySince && now - r.emptySince > ROOM_TTL_MS) rooms.delete(id);
}, 25000);

server.listen(PORT, () => console.log(`Planning Poker prêt sur http://localhost:${PORT}`));
