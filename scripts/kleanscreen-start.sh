#!/bin/bash
# Start KLeanScreen: cage (Wayland kiosk compositor) running the WebKitGTK kiosk.
# Needs a logind seat session (systemd unit with PAMName= and TTYPath=, as
# KlipperScreen.service has), so cage can take the DRM device and inputs.
DIR="$(cd "$(dirname "$(realpath "$0")")/.." && pwd)"
# Python needs PyGObject with cairo support: the system python3 once
# python3-gi-cairo is installed, else KlipperScreen's venv (the trial set-up).
PY="${KLEAN_PYTHON:-}"
if [ -z "$PY" ]; then
    if /usr/bin/python3 -c 'import gi._gi_cairo' 2>/dev/null; then PY=/usr/bin/python3
    else PY="$HOME/.KlipperScreen-env/bin/python"; fi
fi
LOG="${KLEAN_LOG:-$HOME/printer_data/logs/kleanscreen.log}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# WebKit takes time zones from ICU's built-in rules, which predate BC's move to
# permanent UTC-7 (tzdata 2026e has it; ICU still says UTC-8). Hand the page the
# system's current offset as a fixed Etc/GMT zone instead. Vancouver no longer
# changes offset; elsewhere this would need a restart at each DST change.
off=$(date +%z)                                   # e.g. -0700
if [ "${off:3:2}" = 00 ]; then
    h=$((10#${off:1:2}))
    if [ "$h" = 0 ]; then export TZ=Etc/UTC
    elif [ "${off:0:1}" = - ]; then export TZ=Etc/GMT+$h   # Etc/GMT signs are inverted
    else export TZ=Etc/GMT-$h; fi
fi

# A PAM session puts cage in a logind scope outside the service's cgroup, so a
# service restart can leave the previous cage running. Clear it first.
pkill -u "$(id -u)" -x cage
for i in 1 2 3 4 5; do pgrep -u "$(id -u)" -x cage >/dev/null || break; sleep 1; done
pkill -KILL -u "$(id -u)" -x cage
pkill -KILL -u "$(id -u)" -f 'kiosk/kiosk[.]py'
rm -f "$XDG_RUNTIME_DIR"/wayland-*

exec >"$LOG" 2>&1
echo "kleanscreen: python $PY"
exec /usr/bin/cage -d -s -- "$PY" "$DIR/kiosk/kiosk.py" "${KLEAN_QUERY:-}"
