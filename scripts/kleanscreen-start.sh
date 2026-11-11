#!/bin/bash
# Start KLeanScreen: cage (Wayland kiosk compositor) running the WebKitGTK kiosk.
# Needs a logind seat session (systemd unit with PAMName= and TTYPath=, as
# KlipperScreen.service has), so cage can take the DRM device and inputs.
DIR="$(cd "$(dirname "$(realpath "$0")")/.." && pwd)"
PY="${KLEAN_PYTHON:-$HOME/.KlipperScreen-env/bin/python}"
LOG="${KLEAN_LOG:-$HOME/printer_data/logs/kleanscreen.log}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# A PAM session puts cage in a logind scope outside the service's cgroup, so a
# service restart can leave the previous cage running. Clear it first.
pkill -u "$(id -u)" -x cage
for i in 1 2 3 4 5; do pgrep -u "$(id -u)" -x cage >/dev/null || break; sleep 1; done
pkill -KILL -u "$(id -u)" -x cage
pkill -KILL -u "$(id -u)" -f 'kiosk/kiosk[.]py'
rm -f "$XDG_RUNTIME_DIR"/wayland-*

exec >"$LOG" 2>&1
exec /usr/bin/cage -d -s -- "$PY" "$DIR/kiosk/kiosk.py" "${KLEAN_QUERY:-}"
