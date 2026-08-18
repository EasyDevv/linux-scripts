#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${1:-} != --apply || -z ${2:-} || ${3:-} != --setup-source-ip || -z ${4:-} || $# -ne 4 ]]; then
    printf 'Usage: %s --apply DOMAIN --setup-source-ip IPV4\n' "$0" >&2
    exit 2
fi
if [[ $EUID -ne 0 ]]; then
    printf 'Run as root.\n' >&2
    exit 1
fi

domain=$2
setup_source_ip=$4
install_dir=${NETBIRD_INSTALL_DIR:-/opt/netbird}
script_dir=$(dirname "$(readlink -f "$0")")

if [[ ! $domain =~ ^[A-Za-z0-9.-]+$ || ! $setup_source_ip =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    printf 'Invalid domain or setup source IPv4.\n' >&2
    exit 2
fi
IFS=. read -r -a setup_octets <<<"$setup_source_ip"
for octet in "${setup_octets[@]}"; do
    ((10#$octet <= 255)) || { printf 'Invalid setup source IPv4: %s\n' "$setup_source_ip" >&2; exit 2; }
done
for command in podman podman-compose caddy curl jq openssl; do
    command -v "$command" >/dev/null || { printf 'Missing required command: %s\n' "$command" >&2; exit 1; }
done
if [[ -r ${script_dir}/setup-log.sh && -x ${script_dir}/configure-netbird-setup-guard.sh && -r ${script_dir}/netbird-setup-guard.sh ]]; then
    setup_log_source=${script_dir}/setup-log.sh
    configure_guard=${script_dir}/configure-netbird-setup-guard.sh
elif [[ -r /usr/local/lib/vps-setup/setup-log.sh && -x /usr/local/libexec/vps-setup/configure-netbird-setup-guard.sh && -r /usr/local/libexec/vps-setup/netbird-setup-guard.sh ]]; then
    setup_log_source=/usr/local/lib/vps-setup/setup-log.sh
    configure_guard=/usr/local/libexec/vps-setup/configure-netbird-setup-guard.sh
else
    printf 'NetBird setup helper scripts are missing.\n' >&2
    exit 1
fi
if [[ -e ${install_dir}/config.yaml ]]; then
    printf 'Refusing to overwrite an existing NetBird installation at %s.\n' "$install_dir" >&2
    exit 1
fi
getent ahostsv4 "$domain" >/dev/null || { printf 'Domain has no resolvable IPv4: %s\n' "$domain" >&2; exit 1; }

. "$setup_log_source"
setup_log_init
install -d -o root -g root -m 0750 "$install_dir"
umask 077
relay_secret=$(openssl rand -base64 32 | tr -d '=+/\n')
datastore_key=$(openssl rand -base64 32 | tr -d '\n')
cookie_key=$(openssl rand -base64 32 | tr -d '=+/\n')

setup_log_before "${install_dir}/config.yaml"
cat >"${install_dir}/config.yaml" <<EOF
server:
  listenAddress: ":80"
  exposedAddress: "https://${domain}:443"
  stunPorts: [3478]
  metricsPort: 9090
  healthcheckAddress: ":9000"
  logLevel: "info"
  logFile: "console"
  disableAnonymousMetrics: true
  disableGeoliteUpdate: true
  authSecret: "${relay_secret}"
  dataDir: "/var/lib/netbird"
  auth:
    issuer: "https://${domain}/oauth2"
    signKeyRefreshEnabled: true
    sessionCookieEncryptionKey: "${cookie_key}"
    dashboardRedirectURIs:
      - "https://${domain}/nb-auth"
      - "https://${domain}/nb-silent-auth"
    cliRedirectURIs: ["http://localhost:53000/"]
  reverseProxy:
    trustedHTTPProxies: ["10.0.0.0/8"]
  store:
    engine: "sqlite"
    encryptionKey: "${datastore_key}"
EOF
chmod 0600 "${install_dir}/config.yaml"
setup_log_after "${install_dir}/config.yaml"

setup_log_before "${install_dir}/dashboard.env"
cat >"${install_dir}/dashboard.env" <<EOF
NETBIRD_MGMT_API_ENDPOINT=https://${domain}
NETBIRD_MGMT_GRPC_API_ENDPOINT=https://${domain}
AUTH_AUDIENCE=netbird-dashboard
AUTH_CLIENT_ID=netbird-dashboard
AUTH_CLIENT_SECRET=
AUTH_AUTHORITY=https://${domain}/oauth2
USE_AUTH0=false
AUTH_SUPPORTED_SCOPES=openid profile email groups
AUTH_REDIRECT_URI=/nb-auth
AUTH_SILENT_REDIRECT_URI=/nb-silent-auth
NGINX_SSL_PORT=443
LETSENCRYPT_DOMAIN=none
EOF
chmod 0600 "${install_dir}/dashboard.env"
setup_log_after "${install_dir}/dashboard.env"

setup_log_before "${install_dir}/docker-compose.yml"
cat >"${install_dir}/docker-compose.yml" <<'EOF'
services:
  dashboard:
    image: docker.io/netbirdio/dashboard:latest
    container_name: netbird-dashboard
    restart: unless-stopped
    ports: ["127.0.0.1:8080:80"]
    env_file: [./dashboard.env]
    security_opt: [no-new-privileges:true]
    logging:
      driver: k8s-file
      options: { max-size: 50mb }
  netbird-server:
    image: docker.io/netbirdio/netbird-server:latest
    container_name: netbird-server
    restart: unless-stopped
    ports: ["127.0.0.1:8081:80", "3478:3478/udp"]
    volumes:
      - netbird_data:/var/lib/netbird
      - ./config.yaml:/etc/netbird/config.yaml:ro
    command: ["--config", "/etc/netbird/config.yaml"]
    security_opt: [no-new-privileges:true]
    logging:
      driver: k8s-file
      options: { max-size: 50mb }
volumes:
  netbird_data:
EOF
chmod 0640 "${install_dir}/docker-compose.yml"
setup_log_after "${install_dir}/docker-compose.yml"

setup_log_before /etc/caddy/Caddyfile
cat >/etc/caddy/Caddyfile <<EOF
{
    servers {
        protocols h1 h2
    }
}

${domain} {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }
    @grpc header Content-Type application/grpc*
    reverse_proxy @grpc h2c://127.0.0.1:8081
    @backend path /relay* /ws-proxy/* /api/* /oauth2/*
    reverse_proxy @backend 127.0.0.1:8081
    reverse_proxy /* 127.0.0.1:8080
}
EOF
chown root:caddy /etc/caddy/Caddyfile
chmod 0644 /etc/caddy/Caddyfile
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
setup_log_after /etc/caddy/Caddyfile

cd "$install_dir"
setup_log_action 'Pull and start NetBird Podman Compose stack'
podman-compose pull
podman-compose up -d

setup_log_before /etc/systemd/system/netbird-podman.service
cat >/etc/systemd/system/netbird-podman.service <<'EOF'
[Unit]
Description=NetBird self-hosted stack with Podman Compose
Wants=network-online.target
After=network-online.target nftables.service
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/netbird
ExecStart=/usr/bin/podman-compose up -d
ExecStop=/usr/bin/podman-compose down
TimeoutStartSec=300
TimeoutStopSec=120
[Install]
WantedBy=multi-user.target
EOF
setup_log_after /etc/systemd/system/netbird-podman.service

systemctl daemon-reload
systemctl disable podman-restart.service 2>/dev/null || true
systemctl enable netbird-podman.service caddy.service
"$configure_guard" --apply "$domain" "$setup_source_ip"
systemctl restart caddy.service

curl --fail --silent --show-error --retry 30 --retry-all-errors --retry-delay 2 "https://${domain}/oauth2/.well-known/openid-configuration" >/dev/null
printf 'NetBird started and OIDC discovery passed for https://%s\n' "$domain"
printf 'Change log: %s\n' "$VPS_SETUP_LOG"
