#!/bin/bash
# Read-only gates for ovh-vps early-warning. Run as root on the host.
set -euo pipefail

fail=0
ok() { printf 'ok  %s\n' "$1"; }
bad() { printf 'bad %s\n' "$1" >&2; fail=1; }

need_root() {
  if [[ $(id -u) -ne 0 ]]; then
    echo "run as root" >&2
    exit 1
  fi
}

need_root

for unit in caddy crowdsec crowdsec-firewall-bouncer auditd vps-journal-watch falco-modern-bpf; do
  if systemctl is-active --quiet "$unit"; then
    ok "unit $unit"
  else
    bad "unit $unit inactive"
  fi
done

if systemctl is-active --quiet fail2ban 2>/dev/null; then
  bad "fail2ban still active"
else
  ok "fail2ban absent"
fi

if [[ -f /etc/vps-alert/discord.env ]]; then
  ok "discord env present"
else
  bad "missing /etc/vps-alert/discord.env"
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

public_root=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 --resolve vps-a851fbbf.vps.ovh.us:443:127.0.0.1 https://vps-a851fbbf.vps.ovh.us/ || true)
if [[ $public_root == 404 ]]; then
  ok "public dashboard hidden"
else
  bad "public / returned ${public_root:-err} (want 404)"
fi

public_api=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 --resolve vps-a851fbbf.vps.ovh.us:443:127.0.0.1 --resolve vps-a851fbbf.vps.ovh.us:443:127.0.0.1 https://vps-a851fbbf.vps.ovh.us/api/groups || true)
if [[ $public_api == 401 || $public_api == 200 ]]; then
  ok "public management api $public_api"
else
  bad "public /api/groups returned ${public_api:-err} (want 401 or 200)"
fi

overlay_http=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 http://100.85.0.82/ || true)
if [[ $overlay_http == 308 ]]; then
  ok "overlay http redirect $overlay_http"
else
  bad "overlay http returned ${overlay_http:-err} (want 308)"
fi

overlay_dash=$(curl -skS -o /dev/null -w '%{http_code}' --max-time 8 https://100.85.0.82/ || true)
if [[ $overlay_dash == 200 ]]; then
  ok "overlay dashboard"
else
  bad "overlay dashboard returned ${overlay_dash:-err} (want 200)"
fi

spoof=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 -H 'Host: 100.85.0.82' http://15.204.121.190/ || true)
if [[ $spoof != 200 ]]; then
  ok "public host-spoof dashboard closed ($spoof)"
else
  bad "public IP served dashboard for Host 100.85.0.82"
fi

if ss -lnt | grep -q '100.85.0.82:443'; then
  ok "dashboard 443 on wt0"
else
  bad "dashboard 443 missing on 100.85.0.82"
fi
if ss -lnt | grep -Eq '0.0.0.0:443|\*:443'; then
  bad "443 is wildcard; dashboard would leak"
else
  ok "443 not wildcard"
fi

curl -sS -o /tmp/ew-nb-pub-body --max-time 8 --resolve vps-a851fbbf.vps.ovh.us:443:127.0.0.1 https://vps-a851fbbf.vps.ovh.us/ >/dev/null || true
if grep -qi netbird /tmp/ew-nb-pub-body 2>/dev/null; then
  bad "public / body looks like dashboard"
else
  ok "public / body is not dashboard"
fi
curl -skS -o /tmp/ew-nb-ov-body --max-time 8 https://100.85.0.82/ >/dev/null || true
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
