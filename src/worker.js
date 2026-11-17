// Cloudflare Worker: serves the app (static assets), room signaling (Durable Object per room), QR codes, ICE servers.
// Voice audio never touches Cloudflare: it flows device-to-device (WebRTC).
import qrcode from 'qrcode-generator';

const MAX = 10;
const STUN = { urls: 'stun:stun.cloudflare.com:3478' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === '/ws') {
      const code = url.searchParams.get('room') || '';
      if (!/^\d{4}$/.test(code)) return new Response('Bad room', { status: 400 });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }

    if (url.pathname === '/qr') {
      const qr = qrcode(0, 'M');
      qr.addData((url.searchParams.get('text') || '').slice(0, 300));
      qr.make();
      return new Response(qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }), {
        headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' },
      });
    }

    if (url.pathname === '/ice') {
      // Optional TURN relay (only used if devices can't reach each other directly).
      // Enable by setting secrets TURN_KEY_ID and TURN_API_TOKEN (Cloudflare dashboard > Realtime > TURN).
      const list = [STUN];
      if (env.TURN_KEY_ID && env.TURN_API_TOKEN) {
        try {
          const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl: 86400 }),
          });
          const j = await r.json();
          if (j.iceServers) list.push(j.iceServers);
        } catch {}
      }
      return Response.json(list, { headers: { 'cache-control': 'no-store' } });
    }

    return new Response('Not found', { status: 404 });
  },
};

// One Durable Object instance per 4-digit room code.
export class Room {
  constructor() { this.peers = new Map(); }

  async fetch(req) {
    const code = new URL(req.url).searchParams.get('room');
    const [client, ws] = Object.values(new WebSocketPair());
    ws.accept();
    const id = crypto.randomUUID().slice(0, 8);
    let joined = false;
    const send = (s, m) => { try { s.send(JSON.stringify(m)); } catch {} };

    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }

      if (!joined && (m.type === 'create' || m.type === 'join')) {
        if (m.type === 'create' && this.peers.size) return send(ws, { type: 'error', code: 'taken', msg: 'Code already in use.' });
        if (m.type === 'join' && !this.peers.size) return send(ws, { type: 'error', msg: 'Room not found. Check the code.' });
        if (this.peers.size >= MAX) return send(ws, { type: 'error', msg: `Room is full (${MAX} max).` });
        const name = String(m.name || 'Guest').slice(0, 20);
        send(ws, { type: 'joined', id, room: code, peers: [...this.peers].map(([pid, p]) => ({ id: pid, name: p.name })) });
        this.peers.forEach(p => send(p.ws, { type: 'peer-joined', id, name }));
        this.peers.set(id, { ws, name });
        joined = true;
        return;
      }
      if (!joined) return;
      if (m.type === 'signal') { const t = this.peers.get(m.to); t && send(t.ws, { type: 'signal', from: id, data: m.data }); }
      else if (m.type === 'talking') this.peers.forEach((p, pid) => pid !== id && send(p.ws, { type: 'talking', id, on: !!m.on }));
    });

    const bye = () => {
      if (!this.peers.delete(id)) return;
      this.peers.forEach(p => send(p.ws, { type: 'peer-left', id }));
    };
    ws.addEventListener('close', bye);
    ws.addEventListener('error', bye);

    return new Response(null, { status: 101, webSocket: client });
  }
}
