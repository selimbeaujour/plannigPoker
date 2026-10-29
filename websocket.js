// Serveur WebSocket minimal (RFC 6455) sans dépendance : messages texte, ping/pong, fermeture.
const crypto = require("crypto");
const { EventEmitter } = require("events");

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

class Socket extends EventEmitter {
  constructor(sock, maxPayload) {
    super();
    this.sock = sock;
    this.maxPayload = maxPayload;
    this.readyState = 1;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    sock.setNoDelay(true);
    sock.on("data", d => this._onData(d));
    sock.on("close", () => this._closed());
    sock.on("error", () => this._closed());
  }

  _closed() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close");
  }

  _frame(opcode, payload) {
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    if (this.readyState === 1) this.sock.write(Buffer.concat([head, payload]));
  }

  send(text) { this._frame(0x1, Buffer.from(String(text), "utf8")); }
  ping() { this._frame(0x9, Buffer.alloc(0)); }
  close(code = 1000) {
    if (this.readyState !== 1) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code, 0);
    this._frame(0x8, p);
    this.readyState = 2;
    this.sock.end();
  }
  terminate() { this.sock.destroy(); this._closed(); }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; const big = this.buf.readBigUInt64BE(2); if (big > BigInt(this.maxPayload)) return this.close(1009); len = Number(big); off = 10; }
      if (!masked) return this.close(1002); // les clients doivent masquer leurs trames
      if (len > this.maxPayload) return this.close(1009);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (opcode === 0x8) { this.close(); continue; }
      if (opcode === 0x9) { this._frame(0xA, data); continue; }
      if (opcode === 0xA) { this.emit("pong"); continue; }
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        this.fragments.push(data);
        const total = this.fragments.reduce((n, f) => n + f.length, 0);
        if (total > this.maxPayload) return this.close(1009);
        if (fin) { const msg = Buffer.concat(this.fragments); this.fragments = []; this.emit("message", msg.toString("utf8")); }
      }
    }
  }
}

/** Attache un serveur WebSocket à un serveur HTTP existant, sur un chemin donné. */
class WebSocketServer extends EventEmitter {
  constructor({ server, path = "/", maxPayload = 65536 }) {
    super();
    this.clients = new Set();
    server.on("upgrade", (req, sock) => {
      const url = new URL(req.url, "http://localhost");
      const key = req.headers["sec-websocket-key"];
      if (url.pathname !== path || !key || (req.headers.upgrade || "").toLowerCase() !== "websocket") {
        sock.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }
      const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
      sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
      const ws = new Socket(sock, maxPayload);
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
      this.emit("connection", ws, req);
    });
  }
}

module.exports = { WebSocketServer };
