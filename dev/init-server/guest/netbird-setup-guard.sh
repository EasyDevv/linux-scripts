#!/usr/bin/env bash
set -Eeuo pipefail

. /usr/local/lib/vps-setup/setup-log.sh
setup_log_init

caddyfile=/etc/caddy/Caddyfile
restriction=/etc/caddy/netbird-setup-restriction.caddy
service=/etc/systemd/system/netbird-setup-guard.service
timer=/etc/systemd/system/netbird-setup-guard.timer
status=$(/usr/bin/curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8081/api/instance | /usr/bin/jq -r 'if .setup_required == true then "true" elif .setup_required == false then "false" else empty end')

case "$status" in
    true) exit 0 ;;
    false) ;;
    *) exit 1 ;;
esac

new_caddyfile=$(/usr/bin/mktemp)
trap '/usr/bin/rm -f "$new_caddyfile"' EXIT
/usr/bin/awk '$0 != "    import /etc/caddy/netbird-setup-restriction.caddy"' "$caddyfile" >"$new_caddyfile"
/usr/bin/caddy validate --config "$new_caddyfile" --adapter caddyfile >/dev/null
setup_log_before "$caddyfile"
/usr/bin/install -o root -g caddy -m 0644 "$new_caddyfile" "$caddyfile"
setup_log_after "$caddyfile"

for path in "$restriction" "$service" "$timer"; do
    if [[ -e $path || -L $path ]]; then
        /usr/bin/rm -f "$path"
        setup_log_removed "$path"
    fi
done

/usr/bin/systemctl reload caddy
/usr/bin/systemctl disable --now netbird-setup-guard.timer 2>/dev/null || true
/usr/bin/systemctl daemon-reload
setup_log_action 'NetBird initial setup completed; temporary Caddy restriction and timer removed'
