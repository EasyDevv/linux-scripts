#!/bin/bash
# Read-only gates for ovh-vps early-warning. Run as root on the host.
set -euo pipefail

fail=0
ok() { printf 'ok  %s\n' "$1"; }
bad() { printf 'bad %s\n' "$1" >&2; fail=1; }

curl_code() {
  local result="000"
  for _ in $(seq 1 10); do
    result=$(curl "$@" 2>/dev/null || true)
    if [[ $result != 000 ]]; then
      printf '%s' "$result"
      return
    fi
    sleep 1
  done
  printf '%s' "$result"
}

wait_for_listener() {
  local needle=$1
  for _ in $(seq 1 10); do
    if ss -lnt | grep -q "$needle"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

need_root() {
  if [[ $(id -u) -ne 0 ]]; then
    echo "run as root" >&2
    exit 1
  fi
}

need_root

PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-$(hostname -f 2>/dev/null || true)}"
if [[ $PUBLIC_DOMAIN != *.* ]]; then
  hosts_domain=$(awk '$1 == "127.0.0.1" { for (i = 2; i <= NF; i++) if ($i ~ /\./) { print $i; exit } }' /etc/hosts)
  PUBLIC_DOMAIN=${hosts_domain:-$PUBLIC_DOMAIN}
fi
if [[ -z ${PUBLIC_DOMAIN} || $PUBLIC_DOMAIN != *.* ]]; then
  bad "missing public domain (set PUBLIC_DOMAIN)"
  echo "early-warning-verify-failed" >&2
  exit 1
fi

WT0_IP=$(ip -4 -o addr show dev wt0 | awk '{print $4}' | cut -d/ -f1)
PUBLIC_IP=$(ip -4 -o route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
if [[ -z ${WT0_IP} || -z ${PUBLIC_IP} ]]; then
  bad "missing wt0 or public ipv4"
  echo "early-warning-verify-failed" >&2
  exit 1
fi

for unit in caddy crowdsec crowdsec-firewall-bouncer auditd vps-journal-watch falco-modern-bpf; do
  if systemctl is-active --quiet "$unit"; then
    ok "unit $unit"
  else
    bad "unit $unit inactive"
  fi
done

if [[ -f /etc/vps-alert/.env.sender ]]; then
  if grep -q '^DISCORD_WEBHOOK=https://' /etc/vps-alert/.env.sender; then
    ok "Discord webhook configured"
  else
    bad "Discord webhook missing from /etc/vps-alert/.env.sender"
  fi
  if grep -q '^AGENTMAIL_' /etc/vps-alert/.env.sender; then
    bad "AgentMail configuration still present"
  else
    ok "AgentMail configuration absent"
  fi
else
  bad "missing /etc/vps-alert/.env.sender"
fi
if grep -qi 'agentmail' /usr/local/sbin/vps-alert 2>/dev/null; then
  bad "vps-alert still contains AgentMail delivery code"
else
  ok "vps-alert is Discord-only"
fi
if grep -q 'emit("ssh-deny"' /usr/local/sbin/vps-journal-watch 2>/dev/null; then
  bad "individual SSH denials still notify"
else
  ok "individual SSH denials suppressed"
fi
if grep -q 'ssh-deny-burst' /usr/local/sbin/vps-journal-watch 2>/dev/null; then
  ok "SSH denial bursts aggregated"
else
  bad "SSH denial burst policy missing"
fi
if grep -q 'recovery-path-failure' /usr/local/sbin/vps-journal-watch 2>/dev/null; then
  ok "SSH and NetBird recovery failure policy present"
else
  bad "recovery failure policy missing"
fi
if wait_for_listener '127.0.0.1:8766'; then
  ok "alert http 127.0.0.1:8766"
else
  bad "alert http 127.0.0.1:8766 missing"
fi

caddy_dir=$(stat -c '%a %U:%G' /etc/caddy 2>/dev/null || echo missing)
if [[ $caddy_dir == "750 root:caddy" ]]; then
  ok "/etc/caddy 750 root:caddy"
else
  bad "/etc/caddy is '$caddy_dir' (want 750 root:caddy)"
fi

if [[ -x /usr/local/bin/caddy ]] && /usr/local/bin/caddy list-modules 2>/dev/null | grep -q 'http.handlers.appsec'; then
  ok "caddy has appsec module"
else
  bad "caddy missing appsec module"
fi

ss -lnt | grep -q '127.0.0.1:8180' && ok "lapi 8180" || bad "crowdsec lapi not on 127.0.0.1:8180"
ss -lnt | grep -q '127.0.0.1:7422' && ok "appsec 7422" || bad "appsec not on 127.0.0.1:7422"
ss -lnt | grep -q '127.0.0.1:8765' && ok "falco 8765" || bad "falco health not on 127.0.0.1:8765"
ss -lnt | grep -q '127.0.0.1:8080' && ok "netbird 8080" || bad "netbird dashboard 8080 missing"

if grep -q '127.0.0.1:8080' /etc/crowdsec/config.yaml 2>/dev/null; then
  bad "crowdsec config still mentions 127.0.0.1:8080"
else
  ok "crowdsec not on 8080"
fi

if nft list chain ip crowdsec crowdsec-chain-input 2>/dev/null | grep -q 'saddr @crowdsec-blacklists'; then
  ok "crowdsec nft drop"
else
  bad "crowdsec nft drop rule missing"
fi

public_root=$(curl_code -sS -o /dev/null -w '%{http_code}' --max-time 8 --resolve ${PUBLIC_DOMAIN}:443:127.0.0.1 https://${PUBLIC_DOMAIN}/)
if [[ $public_root == 404 ]]; then
  ok "public dashboard hidden"
else
  bad "public / returned ${public_root:-err} (want 404)"
fi

public_api=$(curl_code -sS -o /dev/null -w '%{http_code}' --max-time 8 --resolve ${PUBLIC_DOMAIN}:443:127.0.0.1 --resolve ${PUBLIC_DOMAIN}:443:127.0.0.1 https://${PUBLIC_DOMAIN}/api/groups)
if [[ $public_api == 401 || $public_api == 200 ]]; then
  ok "public management api $public_api"
else
  bad "public /api/groups returned ${public_api:-err} (want 401 or 200)"
fi

overlay_http=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 http://$WT0_IP/ || true)
if [[ $overlay_http == 308 ]]; then
  ok "overlay http redirect $overlay_http"
else
  bad "overlay http returned ${overlay_http:-err} (want 308)"
fi

overlay_dash=$(curl -skS -o /dev/null -w '%{http_code}' --max-time 8 https://$WT0_IP/ || true)
if [[ $overlay_dash == 200 ]]; then
  ok "overlay dashboard"
else
  bad "overlay dashboard returned ${overlay_dash:-err} (want 200)"
fi

spoof=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 -H "Host: $WT0_IP" http://$PUBLIC_IP/ || true)
if [[ $spoof != 200 ]]; then
  ok "public host-spoof dashboard closed ($spoof)"
else
  bad "public IP served dashboard for overlay Host"
fi

# Check the public-facing IPv4 socket separately. Caddy may expose an IPv6
# wildcard for the overlay listener; this host has no public IPv6 address and
# the handler still rejects non-overlay clients.
if ss -lnt4 | grep -q "$WT0_IP:443"; then
  ok "dashboard 443 on wt0"
else
  bad "dashboard 443 missing on wt0"
fi
if ss -lnt4 | grep -Eq '0.0.0.0:443|\*:443'; then
  bad "443 is wildcard; dashboard would leak"
else
  ok "443 not wildcard"
fi

curl_code -sS -o /tmp/ew-nb-pub-body -w '%{http_code}' --max-time 8 --resolve ${PUBLIC_DOMAIN}:443:127.0.0.1 https://${PUBLIC_DOMAIN}/ >/dev/null
if grep -qi netbird /tmp/ew-nb-pub-body 2>/dev/null; then
  bad "public / body looks like dashboard"
else
  ok "public / body is not dashboard"
fi
curl_code -skS -o /tmp/ew-nb-ov-body -w '%{http_code}' --max-time 8 https://$WT0_IP/ >/dev/null
if grep -qi netbird /tmp/ew-nb-ov-body 2>/dev/null; then
  ok "overlay body is dashboard"
else
  bad "overlay body is not dashboard"
fi

if [[ $fail -ne 0 ]]; then
  echo "early-warning-verify-failed" >&2
  exit 1
fi
echo "early-warning-verify-ok"
