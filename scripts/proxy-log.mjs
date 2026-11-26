#!/usr/bin/env node
/**
 * A local proxy that logs every connection it is asked for — the proof for
 * Settings → Privacy → proxy ("requests seen at the proxy, none direct").
 *
 *   node scripts/proxy-log.mjs [--port 18080] [--socks] [--refuse] [--log FILE]
 *
 * HTTP proxy by default (CONNECT tunnels and plain requests); `--socks` makes
 * it a SOCKS5 proxy (no sign-in). `--refuse` answers every request with a
 * refusal, to show that lookups then fail and never go direct. One line per
 * request to the log (default `.verify/proxy.log`): time, kind, host:port,
 * whether it was let through. Nothing is kept of what passes.
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const port = Number(value('--port', 18080));
const refuse = flag('--refuse');
const logFile = value('--log', path.join('.verify', 'proxy.log'));
fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.writeFileSync(logFile, '');

function log(kind, target, verdict) {
  fs.appendFileSync(logFile, `${new Date().toISOString()} ${kind} ${target} ${verdict}\n`);
}

function tunnel(client, host, portNumber, onReady) {
  const upstream = net.connect(portNumber, host, () => {
    onReady();
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const end = () => {
    upstream.destroy();
    client.destroy();
  };
  upstream.on('error', end);
  client.on('error', end);
}

if (flag('--socks')) {
  net
    .createServer((client) => {
      client.once('data', (greeting) => {
        if (greeting[0] !== 5) return client.destroy();
        client.write(Buffer.from([5, 0]));
        client.once('data', (req) => {
          const atyp = req[3];
          let host;
          let at;
          if (atyp === 1) {
            host = [...req.subarray(4, 8)].join('.');
            at = 8;
          } else if (atyp === 3) {
            host = req.subarray(5, 5 + req[4]).toString();
            at = 5 + req[4];
          } else {
            host = req.subarray(4, 20).toString('hex');
            at = 20;
          }
          const target = `${host}:${req.readUInt16BE(at)}`;
          if (refuse) {
            log('SOCKS5', target, 'refused');
            client.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]));
            return;
          }
          log('SOCKS5', target, 'allowed');
          tunnel(client, host, req.readUInt16BE(at), () =>
            client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          );
        });
      });
      client.on('error', () => {});
    })
    .listen(port, '127.0.0.1', () => console.log(`SOCKS5 proxy on 127.0.0.1:${port}${refuse ? ' (refusing)' : ''}`));
} else {
  const server = http.createServer((req, res) => {
    const target = req.url ?? '';
    if (refuse) {
      log('HTTP', target, 'refused');
      res.writeHead(403).end('refused');
      return;
    }
    log('HTTP', target, 'allowed');
    const url = new URL(target);
    const out = http.request(
      { host: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: req.method, headers: req.headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      }
    );
    out.on('error', () => res.writeHead(502).end());
    req.pipe(out);
  });
  server.on('connect', (req, client, head) => {
    const [host, p] = (req.url ?? '').split(':');
    const target = `${host}:${p}`;
    if (refuse) {
      log('CONNECT', target, 'refused');
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    log('CONNECT', target, 'allowed');
    tunnel(client, host, Number(p), () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) client.unshift(head);
    });
  });
  server.listen(port, '127.0.0.1', () =>
    console.log(`HTTP proxy on 127.0.0.1:${port}${refuse ? ' (refusing)' : ''}`)
  );
}
