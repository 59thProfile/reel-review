// A tiny to-do app to try Reel Review on. No dependencies.
//   node example/server.mjs          serves it at http://localhost:4321
//   BUG=1 node example/server.mjs    same app with a planted bug: the counter says "1 items left"
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4321);
const BUG = process.env.BUG === '1';
const pages = { '/': 'index.html', '/about': 'about.html' };

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = pages[url.pathname];
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    let html = fs.readFileSync(path.join(HERE, 'public', file), 'utf8');
    if (BUG) html = html.replace('window.PLANTED_BUG = false', 'window.PLANTED_BUG = true');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  })
  .listen(PORT, () => console.log(`Example app at http://localhost:${PORT}${BUG ? ' (with the planted bug)' : ''}`));
