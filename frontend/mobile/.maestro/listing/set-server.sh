#!/bin/bash
# Usage: set-server.sh <url>   (device NCAIOC216200H57, Gboard must be English; ROG-specific because
# Maestro eraseText/inputText are unreliable there: the text is cleared and typed with adb).
D=NCAIOC216200H57; URL="$1"
export PATH="$PATH:/c/Users/Windows/.maestro/bin:/c/Users/Windows/AppData/Local/Android/Sdk/platform-tools"; export MAESTRO_CLI_NO_ANALYTICS=1
cd "$(dirname "$0")"
OUT=/d/FitnessAssistant/_warroom/evidence/mobile-listing/screens
maestro --device $D test --test-output-dir $OUT _server-open.yaml | grep -E "FAILED|not found"
adb -s $D shell input tap 540 925; sleep 1
adb -s $D shell 'input keyevent 123; for i in $(seq 1 150); do input keyevent 67; done'
adb -s $D shell input text "$URL"
maestro --device $D test --test-output-dir $OUT _server-save.yaml | grep -E "FAILED|not found"
