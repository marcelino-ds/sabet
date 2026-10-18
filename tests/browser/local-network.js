import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';

// Every browser connection terminates here, including tabs opened by an
// extension before Playwright attaches. These fixtures never contact a live AI.
export async function localNetwork(readPage) {
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); };
  const tls = https.createServer({
    key: await readFile(new URL('./fixtures/localhost.key', import.meta.url)),
    cert: await readFile(new URL('./fixtures/localhost.crt', import.meta.url)),
  }, (req, res) => {
    // A fixture is either an HTML string or { type, body } for other resources.
    const page = readPage(req.headers.host, req.url);
    const { type = 'text/html', body } = typeof page === 'object' && page ? page : { body: page };
    res.writeHead(body ? 200 : 204, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body || '');
  });
  tls.on('connection', track);
  await new Promise(resolve => tls.listen(0, '127.0.0.1', resolve));
  const proxy = http.createServer((_req, res) => { res.writeHead(204); res.end(); });
  proxy.on('connection', track);
  proxy.on('connect', (_req, client, head) => {
    const upstream = net.connect(tls.address().port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
    track(upstream);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  return {
    url: 'http://127.0.0.1:' + proxy.address().port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await Promise.all([new Promise(r => proxy.close(r)), new Promise(r => tls.close(r))]);
    },
  };
}
