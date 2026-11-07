#!/bin/bash
# Put a deliberately broken image into the phone's gallery for f-pt-photo-invalid.yaml (device-side fixture, no product code involved).
#   push-broken-image.sh push   [header-only|truncated-png|text]   default header-only  -> /sdcard/Pictures/maestro-broken.jpg (.png for truncated-png)
#   push-broken-image.sh remove                                    delete it again and tell MediaStore
# DEVICE env overrides the serial (default: the ASUS ROG used for Phase M). The TECNO test phone is refused on purpose.
set -u
MODE="${1:-push}"; KIND="${2:-header-only}"
D="${DEVICE:-NCAIOC216200H57}"
if [ "$D" = "15392375AV000582" ]; then echo "refusing: that is the TECNO test phone"; exit 2; fi
export PATH="$PATH:/c/Users/Windows/AppData/Local/Android/Sdk/platform-tools"
export MSYS_NO_PATHCONV=1   # keep /sdcard/... from being rewritten into a Windows path
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT=jpg; [ "$KIND" = "truncated-png" ] && EXT=png
NAME="maestro-broken.$EXT"; REMOTE="/sdcard/Pictures/$NAME"

adb -s "$D" get-state >/dev/null 2>&1 || { echo "device $D is not connected"; exit 1; }
scan() { adb -s "$D" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://$1" >/dev/null 2>&1; }
indexed() { adb -s "$D" shell "content query --uri content://media/external/images/media --projection _id:_display_name:mime_type:_size --where \"_display_name='$1'\"" 2>/dev/null | grep -c "$1"; }

if [ "$MODE" = "remove" ]; then
  for n in maestro-broken.jpg maestro-broken.png; do
    adb -s "$D" shell rm -f "/sdcard/Pictures/$n"; scan "/sdcard/Pictures/$n"
  done
  sleep 2
  echo "MediaStore rows left: $(( $(indexed maestro-broken.jpg) + $(indexed maestro-broken.png) ))"
  exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
node "$(cygpath -m "$HERE")/make-broken-image.mjs" "$(cygpath -m "$TMP")/$NAME" --kind "$KIND" || exit 1
adb -s "$D" shell mkdir -p /sdcard/Pictures
adb -s "$D" push "$(cygpath -m "$TMP")/$NAME" "$REMOTE" || exit 1
adb -s "$D" shell touch "$REMOTE"      # newest file first in the picker's "recent" grid
scan "$REMOTE"; sleep 3
N=$(indexed "$NAME")
if [ "$N" -ge 1 ]; then echo "OK: $NAME is in MediaStore (image picker will list it)"; else echo "WARNING: $NAME is on the card but MediaStore did not index it; open the Photos/Files app once, or re-run"; fi
