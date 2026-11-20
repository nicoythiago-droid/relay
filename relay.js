// Servidor intermedio (relay) para Guerra de la Triple Alianza.
// Empareja a dos jugadores por código de sala y les reenvía los mensajes binarios del juego.
// No interpreta la partida: el anfitrión sigue siendo quien manda.
//
// Uso local:   npm install   y luego   node relay.js
// En la nube:  cualquier servicio que ejecute Node.js y exponga el puerto de la variable PORT.

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin I, L, O, 0 ni 1 para no confundir
const CODE_LEN = 4;
const MAX_ROOMS = 2000;

// código -> { host: WebSocket, guest: WebSocket | null }
const rooms = new Map();

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Triple Alianza relay OK\n");
});

const wss = new WebSocketServer({ server, maxPayload: 1 << 20 });

function newCode() {
  for (;;) {
    let c = "";
    for (let i = 0; i < CODE_LEN; i++) {
      c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    if (!rooms.has(c)) return c;
  }
}

function sendJson(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function handleControl(ws, text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (e) {
    return;
  }
  if (ws.room) return; // ya está dentro de una sala

  if (msg.op === "create") {
    if (rooms.size >= MAX_ROOMS) {
      sendJson(ws, { op: "error", msg: "busy" });
      return;
    }
    const code = newCode();
    rooms.set(code, { host: ws, guest: null });
    ws.room = code;
    ws.role = "host";
    sendJson(ws, { op: "created", code });
  } else if (msg.op === "join") {
    const code = String(msg.code || "").toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      sendJson(ws, { op: "error", msg: "no_room" });
      return;
    }
    if (room.guest) {
      sendJson(ws, { op: "error", msg: "room_full" });
      return;
    }
    room.guest = ws;
    ws.room = code;
    ws.role = "guest";
    sendJson(room.host, { op: "peer_joined" }); // primero al anfitrión
    sendJson(ws, { op: "joined" });
  }
}

function leave(ws) {
  if (!ws.room) return;
  const code = ws.room;
  const room = rooms.get(code);
  ws.room = null;
  if (!room) return;
  if (ws.role === "host") {
    rooms.delete(code);
    if (room.guest) {
      const g = room.guest;
      g.room = null;
      sendJson(g, { op: "peer_left" });
      g.close();
    }
  } else {
    room.guest = null;
    sendJson(room.host, { op: "peer_left" });
  }
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.role = null;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      handleControl(ws, data.toString());
      return;
    }
    const room = ws.room ? rooms.get(ws.room) : null;
    if (!room) return;
    const other = ws.role === "host" ? room.guest : room.host;
    if (other && other.readyState === 1) other.send(data, { binary: true });
  });

  ws.on("close", () => leave(ws));
  ws.on("error", () => {});
});

// Mantiene vivas las conexiones (los servicios gratuitos cortan las que están inactivas).
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

server.listen(PORT, () => {
  console.log("Relay escuchando en el puerto " + PORT);
});
