#!/usr/bin/env bash
set -Eeuo pipefail

target=${1:?Usage: verify-netbird.sh SSH_TARGET DOMAIN}
domain=${2:?Usage: verify-netbird.sh SSH_TARGET DOMAIN}
script_dir=$(dirname "$(readlink -f "$0")")
source "${script_dir}/ssh-options.sh"
failed=0

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; failed=1; }

if curl --fail --silent --show-error "https://${domain}/oauth2/.well-known/openid-configuration" | jq -e --arg domain "$domain" '.issuer == ("https://" + $domain + "/oauth2")' >/dev/null; then
    pass 'OIDC discovery and issuer'
else
    fail 'OIDC discovery and issuer'
fi

setup_code=$(curl --silent --output /dev/null --write-out '%{http_code}' "https://${domain}/setup")
if [[ $setup_code == 200 ]]; then
    pass 'Dashboard setup route'
else
    overlay_ip=$(ssh "${SSH_CONTROL_OPTIONS[@]}" -o BatchMode=yes "$target" "ip -4 -o addr show wt0 | awk '{print \$4}' | cut -d/ -f1" || true)
    overlay_code=""
    if [[ $overlay_ip == 100.* ]]; then
        overlay_code=$(curl --silent --insecure --output /dev/null --write-out '%{http_code}' "https://${overlay_ip}/setup" || true)
    fi
    if [[ $setup_code == 404 && $overlay_code == 200 ]]; then
        pass 'Dashboard setup route (overlay)'
    else
        fail 'Dashboard setup route'
    fi
fi

grpc_headers=$(curl --silent --show-error --http2 --dump-header - --output /dev/null --request POST --header 'Content-Type: application/grpc' "https://${domain}/management.ManagementService/GetServerKey")
if [[ $grpc_headers == *'content-type: application/grpc'* ]]; then
    pass 'gRPC routed through Caddy with h2c backend'
else
    fail 'gRPC routing'
fi

stun_bytes=$(printf '000100002112a4420102030405060708090a0b0c' | xxd -r -p | nc -u -w 3 "$domain" 3478 | wc -c)
if ((stun_bytes >= 20)); then
    pass "STUN response (${stun_bytes} bytes)"
else
    fail 'STUN response'
fi

remote=$(ssh "${SSH_CONTROL_OPTIONS[@]}" -o BatchMode=yes "$target" 'sudo bash -s' <<'REMOTE'
set -Eeuo pipefail
systemctl is-active --quiet caddy netbird-podman nftables
podman ps --format '{{.Names}}' | while IFS= read -r name; do printf '%s\n' "$name"; done
printf '%s\n' PORTS
ss -lnt | while IFS= read -r line; do
    case "$line" in
        *':8080 '*|*':8081 '*) printf '%s\n' "$line" ;;
    esac
done
REMOTE
) || remote=

if [[ $remote == *netbird-dashboard* && $remote == *netbird-server* ]]; then
    pass 'NetBird containers running'
else
    fail 'NetBird containers running'
fi
if [[ $remote == *'127.0.0.1:8080'* && $remote == *'127.0.0.1:8081'* && $remote != *'0.0.0.0:8080'* && $remote != *'0.0.0.0:8081'* ]]; then
    pass 'Backends restricted to loopback'
else
    fail 'Backend bind addresses'
fi

"${script_dir}/sync-vps-setup-log.sh" "$target"

exit "$failed"
