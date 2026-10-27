#!/usr/bin/env python3
"""Serve the dashboards locally and open the ground console.
Web Serial needs http://localhost (or https); ES modules do not load from file://."""
import http.server, os, socketserver, sys, webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}
    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    url = f"http://localhost:{PORT}/index.html"
    print(f"Ground console: {url}\nLive view:      http://localhost:{PORT}/viewer.html\nCtrl+C to stop.")
    webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
