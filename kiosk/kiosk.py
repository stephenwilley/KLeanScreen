#!/usr/bin/env python3
"""KLeanScreen kiosk: serves web/ on 127.0.0.1 and shows it fullscreen in WebKitGTK.

Runs as the only client of the cage Wayland compositor. The page is served over
HTTP rather than file:// because Moonraker refuses websocket connections whose
Origin is "null".

Needs Python with PyGObject and its cairo support (python3-gi, python3-gi-cairo)
plus gir1.2-webkit2-4.1.

Debug hooks, so the screen can be checked over SSH (files in $XDG_RUNTIME_DIR/kleanscreen):
  kill -USR1 <pid>  run cmd.js in the page, then save shot.png 700 ms later
  kill -USR2 <pid>  save shot.png only
"""
import functools
import http.server
import os
import signal
import sys
import threading
import time

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
gi.require_foreign("cairo")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
PORT = int(os.environ.get("KLEAN_PORT", "7136"))
CTL = os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/tmp"), "kleanscreen")
os.makedirs(CTL, exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/tz":
            return super().do_GET()
        # The system's current UTC offset in minutes, for the page's clock.
        body = str(time.localtime().tm_gmtoff // 60).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def serve():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=WEB))
    threading.Thread(target=srv.serve_forever, daemon=True).start()


serve()
query = sys.argv[1] if len(sys.argv) > 1 else ""
url = f"http://127.0.0.1:{PORT}/index.html{query}"

win = Gtk.Window()
win.set_default_size(800, 480)
view = WebKit2.WebView()
s = view.get_settings()
s.set_enable_write_console_messages_to_stdout(True)
s.set_enable_developer_extras(False)
s.set_enable_back_forward_navigation_gestures(False)
view.connect("context-menu", lambda *a: True)          # no long-press menu
win.add(view)
win.connect("destroy", Gtk.main_quit)


def on_crash(_view, reason):
    print("kiosk: web process ended:", reason, "- reloading", flush=True)
    def reload():
        view.load_uri(url)
        return False                                    # one-shot timeout
    GLib.timeout_add(1000, reload)


view.connect("web-process-terminated", on_crash)


def snapshot():
    def done(v, res):
        try:
            v.get_snapshot_finish(res).write_to_png(os.path.join(CTL, "shot.png"))
            print("kiosk: snapshot saved", flush=True)
        except GLib.Error as e:
            print("kiosk: snapshot failed:", e.message, flush=True)
    view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, done)
    return False


def on_usr1():
    try:
        with open(os.path.join(CTL, "cmd.js")) as f:
            view.evaluate_javascript(f.read(), -1, None, None, None, None, None)
    except OSError as e:
        print("kiosk: no cmd.js:", e, flush=True)
    GLib.timeout_add(700, snapshot)
    return True


GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, on_usr1)
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR2, lambda: snapshot() or True)
with open(os.path.join(CTL, "kiosk.pid"), "w") as f:
    f.write(str(os.getpid()))

view.load_uri(url)
win.fullscreen()
win.show_all()
Gtk.main()
