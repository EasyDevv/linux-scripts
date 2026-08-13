#!/bin/bash
# Sunshine Do Command: Switch to dummy display for streaming
# DP-3 = Main monitor (4K), DP-1 = Dummy plug (1080p)

LOGFILE="$HOME/.config/sunshine/display-switch.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [START] $*" >> "$LOGFILE"; }

log "Streaming started - switching to dummy display"

# Create a flag file to indicate streaming is active
touch /tmp/sunshine-streaming-active

# Disable main monitor, make dummy primary
kscreen-doctor output.DP-3.disable output.DP-1.enable output.DP-1.priority.1 2>>"$LOGFILE"
RET=$?

log "kscreen-doctor disable DP-3 / enable DP-1 returned: $RET"

# Fallback: try xrandr if kscreen-doctor fails (XWayland compat)
if [ $RET -ne 0 ]; then
    log "kscreen-doctor failed, trying xrandr fallback"
    xrandr --output DP-3 --off && xrandr --output DP-1 --primary 2>>"$LOGFILE"
    log "xrandr fallback returned: $?"
fi

exit 0
