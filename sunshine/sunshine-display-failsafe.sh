#!/bin/bash
# Failsafe: Restore main display on login if streaming flag is stale
# This handles the case where streaming crashed and undo was never called,
# leaving the dummy display as primary on next boot.
#
# DP-3 = Main monitor (4K), DP-1 = Dummy plug (1080p)

LOGFILE="$HOME/.config/sunshine/display-switch.log"
FLAG="/tmp/sunshine-streaming-active"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [FAILSAFE] $*" >> "$LOGFILE"; }

# Wait for KDE/KWin to be ready
sleep 5

# Check if the streaming flag exists (stale from crash)
if [ -f "$FLAG" ]; then
    log "Stale streaming flag detected — previous session did not end cleanly"
    log "Restoring main display DP-3 and disabling dummy DP-1"

    kscreen-doctor output.DP-3.enable output.DP-3.priority.1 output.DP-1.disable 2>>"$LOGFILE"
    RET=$?
    log "kscreen-doctor returned: $RET"

    if [ $RET -ne 0 ]; then
        log "kscreen-doctor failed, trying xrandr fallback"
        xrandr --output DP-3 --primary && xrandr --output DP-1 --off 2>>"$LOGFILE"
        log "xrandr fallback returned: $?"
    fi

    rm -f "$FLAG"
    log "Cleanup complete"
else
    # Even without flag, check if DP-3 is disabled and DP-1 is active
    # This catches edge cases where the flag was somehow lost
    DP3_STATUS=$(kscreen-doctor -o 2>/dev/null | grep -A1 "Output.*DP-3" | grep -c "enabled")
    DP1_STATUS=$(kscreen-doctor -o 2>/dev/null | grep -A1 "Output.*DP-1" | grep -c "enabled")

    if [ "$DP3_STATUS" -eq 0 ] && [ "$DP1_STATUS" -gt 0 ]; then
        log "WARNING: DP-3 is disabled and DP-1 is active without flag — forcing restore"
        kscreen-doctor output.DP-3.enable output.DP-3.priority.1 output.DP-1.disable 2>>"$LOGFILE"
        log "Force restore returned: $?"
    else
        log "No recovery needed — displays are in normal state"
    fi
fi

exit 0
