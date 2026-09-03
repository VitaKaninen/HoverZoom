"""Static file server for the Hover Zoom test page, with one addition:

    ?slow=<seconds>    delay that response by that many seconds (capped at 20)

`python -m http.server` cannot stall a response, and without stalling one there is no
way to see the resolve spinner locally: every probe against localhost finishes in
single-digit milliseconds, well under the 150 ms delay before the spinner shows. The
reported symptom this reproduces is a hover that appears to do nothing for seconds,
then works instantly a while later once the probe has quietly finished and cached.

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


class SlowHandler(SimpleHTTPRequestHandler):
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
