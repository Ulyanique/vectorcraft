#!/usr/bin/env python3
"""Static server for the VectorCraft browser edition.

Serves this directory as the site root, and the repository's examples/ and
assets/ at the same paths the editor fetches.
"""
import mimetypes
import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)

mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("font/otf", ".otf")
mimetypes.add_type("application/json", ".vectorcraft")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/wasm", ".wasm")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **getattr(SimpleHTTPRequestHandler, "extensions_map", {}),
        ".ttf": "font/ttf",
        ".otf": "font/otf",
        ".vectorcraft": "application/json",
        ".wasm": "application/wasm",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
    }

    def translate_path(self, path):
        parsed = unquote(urlparse(path).path)
        parts = [p for p in parsed.split("/") if p and p not in (".", "..")]
        base = REPO if parts and parts[0] in ("examples", "assets") else ROOT
        full = os.path.join(base, *parts) if parts else ROOT
        if os.path.isdir(full):
            index = os.path.join(full, "index.html")
            if os.path.isfile(index):
                return index
        return full

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and str(args[1]).startswith("4"):
            super().log_message(fmt, *args)


def main():
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"VectorCraft browser edition on http://0.0.0.0:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
