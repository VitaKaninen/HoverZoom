"""Static file server for the Hover Zoom test page, with two additions:

    ?slow=<seconds>    delay that response by that many seconds (capped at 20)
    /rotate.php        a forum's "random image" endpoint: what it returns depends on
                       the query, so dropping the query asks a different question

`python -m http.server` cannot stall a response, and without stalling one there is no
way to see the resolve spinner locally: every probe against localhost finishes in
single-digit milliseconds, well under the 150 ms delay before the spinner shows. The
reported symptom this reproduces is a hover that appears to do nothing for seconds,
then works instantly a while later once the probe has quietly finished and cached.

/rotate.php is the rotating-banner shape, reported 2026-09-03 as "hovering the 1200x125
banner gives me the 600x600 sidebar picture". The query is the REQUEST, not a resize:
/rotate.php?loc=header is the masthead, and bare /rotate.php is the site's general random
picture. The generic query-strip rule turned the first into the second and the preview
became an unrelated image -- and a consistent one, so no later check could catch it.

It is deterministic on the query rather than actually random, because a test has to be able
to assert which picture came back. Real rotators also vary per request; that variation is
NOT what makes the bug, and assuming it was cost a round: measured in Chrome, a second load
of a url the document already displays does not hit the network at all, no-store or not.

    python test-server.py            # http://localhost:8899/test-page.html
"""

import os
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# Honour $PORT so two sessions can run their own copy side by side; the documented
# `python test-server.py` still lands on 8899.
PORT = int(os.environ.get("PORT") or 8899)


# Two shapes that are nothing alike (9.6:1 against 1:1), so a preview built from one is
# obviously not the other -- the bug is an unrelated picture, not a wrong size.
BANNER = "banner-1200x125.jpg"
GENERAL = "sidebar-600x600.jpg"


class SlowHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlparse(self.path).path == "/rotate.php":
            return self.serve_rotating()
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_HEAD(self):
        if urlparse(self.path).path == "/rotate.php":
            return self.serve_rotating(head=True)
        return SimpleHTTPRequestHandler.do_HEAD(self)

    def serve_rotating(self, head=False):
        name = BANNER if urlparse(self.path).query else GENERAL
        with open(os.path.join("test-images", name), "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def send_head(self):
        # translate_path() already drops the query, so the delay is purely advisory
        # and the same file can be served fast and slow from the one fixture.
        params = parse_qs(urlparse(self.path).query)
        try:
            delay = min(float(params.get("slow", ["0"])[0]), 20.0)
        except ValueError:
            delay = 0.0
        if delay > 0:
            time.sleep(delay)
        return SimpleHTTPRequestHandler.send_head(self)

    def log_message(self, fmt, *args):
        pass


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    print("serving http://localhost:%d/test-page.html" % PORT)
    # Threading matters here: a single-threaded server would let one ?slow= request
    # block every other fixture on the page.
    ThreadingHTTPServer(("127.0.0.1", PORT), SlowHandler).serve_forever()


if __name__ == "__main__":
    main()
