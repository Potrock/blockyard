#!/usr/bin/env node
// A bad network, for testing: a WebSocket relay to a game server that adds lag and jitter each
// way (messages stay in order).
//
//   node scripts/lagproxy.mjs 8797 ws://localhost:8787 40 30   # 40 ms, plus up to 30 ms more, each way
//   then open http://localhost:5173/?server=ws://localhost:8797/sandbox
import { WebSocketServer, WebSocket } from 'ws';
const [port = '8797', target = 'ws://localhost:8796', delay = '40', jitter = '30'] = process.argv.slice(2);
const D = Number(delay), J = Number(jitter);
const wss = new WebSocketServer({ port: Number(port), perMessageDeflate: false });
wss.on('connection', (client, req) => {
  const up = new WebSocket(target + req.url);
  const early = [];
  const pipe = (from, to, ready) => {
    let last = 0;
    from.on('message', (data, binary) => {
      const at = Math.max(last, Date.now() + D + Math.random() * J);
      last = at;
      setTimeout(() => { if (ready()) to.send(data, { binary }); else early.push(() => to.send(data, { binary })); }, at - Date.now());
    });
  };
  pipe(client, up, () => up.readyState === 1);
  pipe(up, client, () => client.readyState === 1);
  up.on('open', () => { for (const f of early.splice(0)) f(); });
  up.on('close', (c, r) => client.close(c === 1005 ? 1000 : c, r));
  client.on('close', () => up.close());
  up.on('error', () => client.close());
  client.on('error', () => up.close());
});
console.log(`lag proxy on ${port} → ${target}, ${D} ± ${J} ms each way`);
