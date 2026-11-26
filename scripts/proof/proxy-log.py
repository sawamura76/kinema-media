#!/usr/bin/env python3
"""A logging HTTP proxy for a PC without Node (the Linux test PC):
CONNECT tunnels and plain requests, one line per request, nothing kept of
what passes. Same log shape as scripts/proxy-log.mjs.

    proxy-log.py <port> <logfile>
"""
import socket, sys, threading, time

port, logfile = int(sys.argv[1]), sys.argv[2]
open(logfile, "w").close()
lock = threading.Lock()


def log(kind, target, verdict):
    with lock, open(logfile, "a") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {kind} {target} {verdict}\n")


def pipe(a, b):
    try:
        while (d := a.recv(65536)):
            b.sendall(d)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass


def handle(c):
    try:
        head = b""
        while b"\r\n\r\n" not in head:
            d = c.recv(65536)
            if not d: return
            head += d
        first = head.split(b"\r\n")[0].decode(errors="replace").split()
        if first[0] == "CONNECT":
            host, p = first[1].rsplit(":", 1)
            up = socket.create_connection((host, int(p)), timeout=15)
            log("CONNECT", first[1], "ok")
            c.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
            threading.Thread(target=pipe, args=(up, c), daemon=True).start()
            pipe(c, up)
        else:
            url = first[1]
            host = url.split("//", 1)[-1].split("/", 1)[0]
            h, _, p = host.partition(":")
            up = socket.create_connection((h, int(p or 80)), timeout=15)
            log("HTTP", host, "ok")
            up.sendall(head)
            threading.Thread(target=pipe, args=(c, up), daemon=True).start()
            pipe(up, c)
    except Exception as e:
        log("ERROR", str(e)[:60], "failed")
    finally:
        c.close()


s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", port))
s.listen(64)
while True:
    conn, _ = s.accept()
    threading.Thread(target=handle, args=(conn,), daemon=True).start()
