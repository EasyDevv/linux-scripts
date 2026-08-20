#!/usr/bin/env bash
set -Eeuo pipefail

mode=${1:-}
domain=${2:-}
allowed_ip=${3:-}
script_dir=$(dirname "$(readlink -f "$0")")

if [[ $mode != --apply && $mode != --remove ]]; then
    printf 'Usage: %s --apply DOMAIN IPV4\n' "$0" >&2
    printf '       %s --remove DOMAIN\n' "$0" >&2
    exit 2
fi
if [[ ! $domain =~ ^[A-Za-z0-9.-]+$ ]]; then
    printf 'Invalid domain: %s\n' "$domain" >&2
    exit 2
fi
if [[ $mode == --apply && ! $allowed_ip =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    printf 'Invalid setup source IPv4: %s\n' "$allowed_ip" >&2
    exit 2
fi

if [[ -r /usr/local/lib/vps-setup/setup-log.sh ]]; then
    . /usr/local/lib/vps-setup/setup-log.sh
elif [[ -r ${script_dir}/setup-log.sh ]]; then
    . "${script_dir}/setup-log.sh"
else
    printf 'setup-log.sh is required next to this script.\n' >&2
    exit 1
fi
setup_log_init

lib_dir=/usr/local/lib/vps-setup
libexec_dir=/usr/local/libexec/vps-setup
caddyfile=/etc/caddy/Caddyfile
restriction=/etc/caddy/netbird-setup-restriction.caddy
service=/etc/systemd/system/netbird-setup-guard.service
timer=/etc/systemd/system/netbird-setup-guard.timer

install -d -o root -g root -m 0755 "$lib_dir" "$libexec_dir"
if [[ $script_dir != "$libexec_dir" ]]; then
    setup_log_before "${lib_dir}/setup-log.sh"
    install -o root -g root -m 0644 "${script_dir}/setup-log.sh" "${lib_dir}/setup-log.sh"
    setup_log_after "${lib_dir}/setup-log.sh"
    for file in configure-netbird-setup-guard.sh netbird-setup-guard.sh; do
        setup_log_before "${libexec_dir}/${file}"
        install -o root -g root -m 0750 "${script_dir}/${file}" "${libexec_dir}/${file}"
        setup_log_after "${libexec_dir}/${file}"
    done
fi

if [[ $mode == --remove ]]; then
    new_caddyfile=$(mktemp)
    trap 'rm -f "$new_caddyfile"' EXIT
    awk '$0 != "    import /etc/caddy/netbird-setup-restriction.caddy"' "$caddyfile" >"$new_caddyfile"
    caddy validate --config "$new_caddyfile" --adapter caddyfile >/dev/null
    setup_log_before "$caddyfile"
    install -o root -g caddy -m 0644 "$new_caddyfile" "$caddyfile"
    setup_log_after "$caddyfile"
    for path in "$restriction" "$service" "$timer"; do
        if [[ -e $path || -L $path ]]; then
            rm -f "$path"
            setup_log_removed "$path"
        fi
    done
    systemctl disable --now netbird-setup-guard.timer 2>/dev/null || true
    systemctl daemon-reload
    systemctl reset-failed netbird-setup-guard.service netbird-setup-guard.timer 2>/dev/null || true
    if systemctl is-active --quiet caddy; then
        systemctl reload caddy
    fi
    setup_log_action 'Temporary NetBird setup restriction removed manually'
    exit 0
fi

IFS=. read -r -a octets <<<"$allowed_ip"
for octet in "${octets[@]}"; do
    ((10#$octet <= 255)) || { printf 'Invalid setup source IPv4: %s\n' "$allowed_ip" >&2; exit 2; }
done

setup_log_before "$restriction"
cat >"$restriction" <<EOF
@netbird_setup_blocked {
    path /setup /setup/* /api/setup /api/setup/*
    not remote_ip ${allowed_ip}
}
respond @netbird_setup_blocked 404
EOF
chown root:caddy "$restriction"
chmod 0644 "$restriction"
setup_log_after "$restriction"

new_caddyfile=$(mktemp)
trap 'rm -f "$new_caddyfile"' EXIT
awk -v domain="$domain" '
    $0 == "    import /etc/caddy/netbird-setup-restriction.caddy" { next }
    { print }
    $0 == domain " {" && !inserted {
        print "    import /etc/caddy/netbird-setup-restriction.caddy"
        inserted=1
    }
    END { if (!inserted) exit 1 }
' "$caddyfile" >"$new_caddyfile"
caddy validate --config "$new_caddyfile" --adapter caddyfile >/dev/null
if ! cmp -s "$caddyfile" "$new_caddyfile"; then
    setup_log_before "$caddyfile"
    install -o root -g caddy -m 0644 "$new_caddyfile" "$caddyfile"
    setup_log_after "$caddyfile"
fi

setup_log_before "$service"
cat >"$service" <<EOF
[Unit]
Description=Remove the temporary NetBird setup restriction after onboarding
After=netbird-podman.service

[Service]
Type=oneshot
ExecStart=${libexec_dir}/netbird-setup-guard.sh
EOF
setup_log_after "$service"

setup_log_before "$timer"
cat >"$timer" <<'EOF'
[Unit]
Description=Watch NetBird initial setup status

[Timer]
OnBootSec=30s
OnUnitActiveSec=30s
AccuracySec=5s
Unit=netbird-setup-guard.service

[Install]
WantedBy=timers.target
EOF
setup_log_after "$timer"

systemctl daemon-reload
if systemctl is-active --quiet caddy; then
    systemctl reload caddy
fi
setup_log_action "NetBird setup restricted to ${allowed_ip}"
systemctl enable --now netbird-setup-guard.timer
printf 'Setup page and /api/setup restricted to %s.\n' "$allowed_ip"
