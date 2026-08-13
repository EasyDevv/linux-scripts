#!/bin/bash
# Sunshine Undo Command: Restore main display after streaming
# DP-3 = Main monitor (4K), DP-1 = Dummy plug (1080p)

LOGFILE="$HOME/.config/sunshine/display-switch.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [STOP] $*" >> "$LOGFILE"; }

log "Streaming stopped - restoring main display"

# Remove streaming flag
rm -f /tmp/sunshine-streaming-active

# Enable main monitor, disable dummy
kscreen-doctor output.DP-3.enable output.DP-3.priority.1 output.DP-1.disable 2>>"$LOGFILE"
RET=$?

log "kscreen-doctor enable DP-3 / disable DP-1 returned: $RET"

# Fallback: try xrandr if kscreen-doctor fails
if [ $RET -ne 0 ]; then
    log "kscreen-doctor failed, trying xrandr fallback"
    xrandr --output DP-3 --primary && xrandr --output DP-1 --off 2>>"$LOGFILE"
    log "xrandr fallback returned: $?"
fi

exit 0
