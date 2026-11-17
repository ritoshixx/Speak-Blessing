# Speak Blessing on Cloudflare

Voice rooms (up to 10 people, 4-digit code or QR, push-to-talk and hands-free) hosted on Cloudflare Workers.
Cloudflare only serves the page and passes room/connection messages. Voice goes device-to-device (WebRTC).

## Deploy
1. `npm install`
2. `npx wrangler login`
3. `npx wrangler deploy` -> gives you `https://speak-blessing.<your-subdomain>.workers.dev`
Free plan works (the room object uses SQLite-backed Durable Objects).
Test locally with `npx wrangler dev`.

## Using it
Open the URL on the host device, tap Create a room, and show the QR. Others tap "Scan QR code to join" on the main page and join automatically (or scan with their camera app, then tap Join; or type the code). Real HTTPS, so no certificate warnings.

## Same-network audio
Devices on the same Wi-Fi/hotspot (without client isolation) connect directly, so voice stays on the local network
and latency stays low. Devices on different networks usually connect directly too, via STUN.
Strict mobile carriers or firewalls may block that. For those, add Cloudflare's TURN relay:
Cloudflare dashboard > Realtime > TURN > create a key, then
`npx wrangler secret put TURN_KEY_ID` and `npx wrangler secret put TURN_API_TOKEN`.

## Note
Everyone now needs internet to reach the Worker (a hotspot with mobile data is enough). It no longer works fully offline;
use the earlier Node version for that.
