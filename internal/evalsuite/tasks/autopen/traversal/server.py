#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
LOG = os.path.join(ROOT, "access.log")
PORT_FILE = os.path.join(ROOT, "port.txt")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        with open(LOG, "a", encoding="utf-8") as log:
            log.write(self.path + "\n")
        query = parse_qs(parsed.query)
        name = (query.get("file") or [""])[0]
        if parsed.path == "/" or parsed.path == "/index.html":
            target = os.path.join(PUBLIC, "index.html")
        else:
            target = os.path.join(PUBLIC, name)
        try:
            data = open(target, "rb").read()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        return


def main():
    server = HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    with open(PORT_FILE, "w", encoding="utf-8") as handle:
        handle.write(str(port))
    server.serve_forever()


if __name__ == "__main__":
    main()
