#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

usage() {
	cat <<'EOF'
Usage: podman-deploy --init [--host-only] [project-dir]

Bootstrap a fresh remote host for podman-deploy.

Options:
  --host-only   Prepare only host-level Caddy/Tailscale state

What it does on the remote host:
  - installs missing podman/caddy/tailscale packages when pacman is available
  - enables tailscaled
  - verifies Tailscale is already authenticated
  - writes /etc/caddy/Caddyfile and /etc/caddy/conf.d/
  - issues the host TLS cert with tailscale cert
  - installs a sudo-approved helper for per-app Caddy apply/remove
  - enables caddy and a daily cert renewal timer
  - optionally syncs the current project's Caddy path rule

Prerequisite:
  - the remote host must already be reachable over SSH
  - if Tailscale is not authenticated yet, run `sudo tailscale up` there first

Infrastructure config: $XDG_DATA_HOME/scripts/dev/podman-deploy.conf
  PODMAN_SSH_HOST           (required)
  PODMAN_TAILSCALE_DOMAIN   (required)
  PODMAN_SSH_USER           (default: $USER)
  PODMAN_TAILSCALE_HOST     (default: remote hostname)

Project overrides (<project>/.env):
  PODMAN_PORT               (recommended — fallback: 3000)
  PODMAN_BASE_PATH          (default: /{name})
  PODMAN_BIND_ADDR          (default: 127.0.0.1)
EOF
}

HOST_ONLY=""
PROJECT_DIR="."
for arg in "$@"; do
	case "$arg" in
		--host-only) HOST_ONLY=1 ;;
		-h|--help) usage; exit 0 ;;
		-*) echo "Unknown option: $arg" >&2; usage >&2; exit 1 ;;
		*) PROJECT_DIR="$arg" ;;
	esac
done

unset TEST_PASS
podman_load_context "$PROJECT_DIR" 1
PODMAN_PORT="${PODMAN_PORT:-3000}"

podman_read_test_pass() {
	printf '%s' "${TEST_PASS:-}"
}

BOOTSTRAP_SUDO_PASSWORD="$(podman_read_test_pass | tr -d '\r')"

podman_remote_faillock_count() {
	ssh "${SSH_BASE_OPTS[@]}" "${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}" \
		"sh -lc 'if command -v faillock >/dev/null 2>&1; then faillock --user \"${PODMAN_SSH_USER}\" 2>/dev/null | tail -n +2 | grep -c \"^[0-9]\"; else echo 0; fi'" \
		2>/dev/null || echo 0
}

podman_prompt_masked_secret() {
	local prompt=$1
	local secret=""
	local char

	if [ ! -r /dev/tty ]; then
		echo "ERROR: /dev/tty is not available for password input." >&2
		return 1
	fi

	printf '%s' "$prompt" > /dev/tty
	while true; do
		if ! IFS= read -r -s -n 1 char < /dev/tty; then
			printf '\n' > /dev/tty
			return 1
		fi

		case "$char" in
			"")
				break
				;;
			$'\177'|$'\b')
				if [ -n "$secret" ]; then
					secret="${secret%?}"
					printf '\b \b' > /dev/tty
				fi
				;;
			*)
				secret+="$char"
				printf '*' > /dev/tty
				;;
		esac
	done

	printf '\n' > /dev/tty
	REPLY=$secret
}

podman_remote_bootstrap_payload_b64() {
	printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
		"$REMOTE_BOOTSTRAP_PATH" \
		"$PODMAN_DOMAIN" \
		"$PODMAN_SSH_USER" \
		"$REMOTE_SITE_NAME" \
		"$REMOTE_BASE_PATH" \
		"$PODMAN_BIND_ADDR" \
		"$PODMAN_PORT" | base64 | tr -d '\n'
}

podman_run_remote_bootstrap_without_password() {
	local payload_b64
	payload_b64="$(podman_remote_bootstrap_payload_b64)"

	ssh "${SSH_BASE_OPTS[@]}" "${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}" bash -s -- "$payload_b64" <<'EOF'
set -euo pipefail

PAYLOAD_B64="${1:?payload required}"
mapfile -t BOOTSTRAP_ARGS < <(printf '%s' "$PAYLOAD_B64" | base64 -d)

exec sudo -n bash "${BOOTSTRAP_ARGS[0]}" "${BOOTSTRAP_ARGS[1]}" "${BOOTSTRAP_ARGS[2]}" "${BOOTSTRAP_ARGS[3]}" "${BOOTSTRAP_ARGS[4]}" "${BOOTSTRAP_ARGS[5]}" "${BOOTSTRAP_ARGS[6]}"
EOF
}

podman_run_remote_bootstrap_with_password() {
	local password=$1
	local output_file
	local password_b64
	local payload_b64
	output_file="$(mktemp)"
	password_b64="$(printf '%s' "$password" | base64 | tr -d '\n')"
	payload_b64="$(podman_remote_bootstrap_payload_b64)"

	if ssh "${SSH_BASE_OPTS[@]}" "${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}" bash -s -- \
		"$password_b64" \
		"$payload_b64" \
		2> >(tee "$output_file" >&2) <<'EOF'; then
set -euo pipefail

PASSWORD_B64="${1:?password required}"
PAYLOAD_B64="${2:?payload required}"
PASSWORD="$(printf '%s' "$PASSWORD_B64" | base64 -d)"
trap 'unset PASSWORD PASSWORD_B64' EXIT
mapfile -t BOOTSTRAP_ARGS < <(printf '%s' "$PAYLOAD_B64" | base64 -d)

printf '%s\n' "$PASSWORD" | sudo -S -k -p '' bash "${BOOTSTRAP_ARGS[0]}" "${BOOTSTRAP_ARGS[1]}" "${BOOTSTRAP_ARGS[2]}" "${BOOTSTRAP_ARGS[3]}" "${BOOTSTRAP_ARGS[4]}" "${BOOTSTRAP_ARGS[5]}" "${BOOTSTRAP_ARGS[6]}"
EOF
		rm -f "$output_file"
		return 0
	fi

	if grep -Eq 'incorrect password attempt|Sorry, try again|a password is required|no password was provided' "$output_file"; then
		rm -f "$output_file"
		return 10
	fi

	rm -f "$output_file"
	return 1
}

echo "podman-deploy --init"
echo "  target: https://${PODMAN_DOMAIN}${PODMAN_BASE_PATH:-}"
echo "  remote: ${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}"
echo "  mode:   $(if [ -n "$HOST_ONLY" ]; then printf 'host-only'; else printf 'host+project'; fi)"

REMOTE_SITE_NAME="${PODMAN_IMAGE_NAME:-}"
REMOTE_BASE_PATH="${PODMAN_BASE_PATH:-}"
if [ -n "$HOST_ONLY" ]; then
	REMOTE_SITE_NAME=""
	REMOTE_BASE_PATH=""
fi

REMOTE_BOOTSTRAP_LOCAL="$(mktemp)"
REMOTE_BOOTSTRAP_PATH=""

cleanup_remote_bootstrap() {
	rm -f "$REMOTE_BOOTSTRAP_LOCAL"
	if [ -n "$REMOTE_BOOTSTRAP_PATH" ]; then
		ssh "${SSH_BASE_OPTS[@]}" "${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}" rm -f "$REMOTE_BOOTSTRAP_PATH" >/dev/null 2>&1 || true
	fi
}
trap cleanup_remote_bootstrap EXIT

cat > "$REMOTE_BOOTSTRAP_LOCAL" <<'REMOTE_BOOTSTRAP'
set -euo pipefail

DOMAIN="${1:?domain required}"
DEPLOY_USER="${2:?deploy user required}"
SITE_NAME="${3-}"
BASE_PATH="${4-}"
BIND_ADDR="${5:?bind addr required}"
PORT="${6:?port required}"

echo "Preparing remote host..."

CERT_DIR="/etc/caddy/certs"
CADDYFILE="/etc/caddy/Caddyfile"
SITE_DIR="/etc/caddy/conf.d"
HELPER="/usr/local/bin/podman-sync-caddy-site"
SUDOERS_FILE="/etc/sudoers.d/podman-sync-caddy-site"
CADDY_ADMIN="unix//run/caddy/admin.socket"

need_cmd() {
	command -v "$1" >/dev/null 2>&1
}

run_quiet() {
	local log_file
	log_file="$(mktemp)"
	if "$@" >"$log_file" 2>&1; then
		rm -f "$log_file"
		return 0
	fi
	cat "$log_file" >&2
	rm -f "$log_file"
	return 1
}

try_quiet() {
	local log_file
	log_file="$(mktemp)"
	if "$@" >"$log_file" 2>&1; then
		rm -f "$log_file"
		return 0
	fi
	rm -f "$log_file"
	return 1
}

missing_packages=()
need_cmd podman || missing_packages+=(podman)
need_cmd caddy || missing_packages+=(caddy)
need_cmd tailscale || missing_packages+=(tailscale)

if [ "${#missing_packages[@]}" -gt 0 ]; then
	if ! need_cmd pacman; then
		echo "ERROR: missing packages: ${missing_packages[*]}" >&2
		echo "Install them manually on the remote host, then rerun podman-deploy --init." >&2
		exit 1
	fi
	pacman -S --needed "${missing_packages[@]}"
fi

systemctl enable --now tailscaled

if ! tailscale status >/dev/null 2>&1; then
	echo "ERROR: tailscale is not authenticated on the remote host." >&2
	echo "Run 'sudo tailscale up' there first, then rerun podman-deploy --init." >&2
	exit 1
fi

tailscale set --operator="$DEPLOY_USER" >/dev/null 2>&1 || true
loginctl enable-linger "$DEPLOY_USER" >/dev/null 2>&1 || true

install -d -m 755 /etc/caddy
install -d -m 755 "$SITE_DIR"
install -d -m 750 -o root -g caddy "$CERT_DIR"

run_quiet tailscale cert --cert-file "$CERT_DIR/$DOMAIN.crt" --key-file "$CERT_DIR/$DOMAIN.key" "$DOMAIN"
chown root:caddy "$CERT_DIR/$DOMAIN.crt" "$CERT_DIR/$DOMAIN.key"
chmod 640 "$CERT_DIR/$DOMAIN.crt" "$CERT_DIR/$DOMAIN.key"

cat > "$CADDYFILE" <<EOF
${DOMAIN} {
	tls ${CERT_DIR}/${DOMAIN}.crt ${CERT_DIR}/${DOMAIN}.key
	import ${SITE_DIR}/*.caddy
}
EOF

cat > "$HELPER" <<'HELPER_EOF'
#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:?action required}"
CADDY_ADMIN="unix//run/caddy/admin.socket"

run_quiet() {
	local log_file
	log_file="$(mktemp)"
	if "$@" >"$log_file" 2>&1; then
		rm -f "$log_file"
		return 0
	fi
	cat "$log_file" >&2
	rm -f "$log_file"
	return 1
}

try_quiet() {
	local log_file
	log_file="$(mktemp)"
	if "$@" >"$log_file" 2>&1; then
		rm -f "$log_file"
		return 0
	fi
	rm -f "$log_file"
	return 1
}

validate_site_name() {
	local site_name=$1
	if [[ ! "$site_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
		echo "Error: site name must contain only letters, digits, dot, underscore, or dash" >&2
		exit 1
	fi
}

validate_base_path() {
	local base_path=$1
	if [ -n "$base_path" ] && [[ "$base_path" != /* ]]; then
		echo "Error: base path must start with '/' when set" >&2
		exit 1
	fi
}

restart_caddy() {
	if systemctl is-active --quiet caddy; then
		if ! try_quiet caddy reload --config /etc/caddy/Caddyfile --address "$CADDY_ADMIN"; then
			systemctl restart caddy
		fi
	else
		systemctl start caddy
	fi
}

apply_site() {
	local site_name=${1:?site name required}
	local base_path=${2-}
	local bind_addr=${3:?bind addr required}
	local port=${4:?port required}
	local dest="/etc/caddy/conf.d/${site_name}.caddy"
	local tmp backup had_existing=0

	validate_site_name "$site_name"
	validate_base_path "$base_path"

	tmp="$(mktemp)"
	backup="$(mktemp)"
	cleanup() {
		rm -f "$tmp" "$backup"
	}
	trap cleanup RETURN

	if [ -n "$base_path" ]; then
		cat > "$tmp" <<EOF
reverse_proxy ${base_path}* ${bind_addr}:${port} {
	header_up X-Forwarded-Proto https
}
EOF
	else
		cat > "$tmp" <<EOF
reverse_proxy ${bind_addr}:${port} {
	header_up X-Forwarded-Proto https
}
EOF
	fi

	if [ -f "$dest" ]; then
		cp "$dest" "$backup"
		had_existing=1
	fi

	install -m 0644 "$tmp" "$dest"
	if ! caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
		if [ "$had_existing" = "1" ]; then
			install -m 0644 "$backup" "$dest"
		else
			rm -f "$dest"
		fi
		echo "Error: Caddy validation failed; previous site config restored" >&2
		exit 1
	fi

	restart_caddy
	trap - RETURN
	cleanup
}

remove_site() {
	local site_name=${1:?site name required}
	local dest="/etc/caddy/conf.d/${site_name}.caddy"
	local backup

	validate_site_name "$site_name"
	if [ ! -f "$dest" ]; then
		return 0
	fi

	backup="$(mktemp)"
	cleanup() {
		rm -f "$backup"
	}
	trap cleanup RETURN
	cp "$dest" "$backup"
	rm -f "$dest"

	if ! caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
		install -m 0644 "$backup" "$dest"
		echo "Error: Caddy validation failed; previous site config restored" >&2
		exit 1
	fi

	restart_caddy
	trap - RETURN
	cleanup
}

case "$ACTION" in
	apply)
		apply_site "${2:?site name required}" "${3-}" "${4:?bind addr required}" "${5:?port required}"
		;;
	remove)
		remove_site "${2:?site name required}"
		;;
	*)
		echo "Error: unknown action '$ACTION'" >&2
		exit 1
		;;
esac
HELPER_EOF

chmod 755 "$HELPER"

sudoers_tmp="$(mktemp)"
printf '%s\n' "$DEPLOY_USER ALL=(root) NOPASSWD: $HELPER *" > "$sudoers_tmp"
visudo -cf "$sudoers_tmp" >/dev/null
rm -f "$SUDOERS_FILE"
install -m 0440 "$sudoers_tmp" "$SUDOERS_FILE"
rm -f "$sudoers_tmp"

cat > /etc/systemd/system/caddy-cert-renewal.service <<EOF
[Unit]
Description=Renew Tailscale TLS certificate for Caddy (${DOMAIN})
After=network-online.target tailscaled.service

[Service]
Type=oneshot
ExecStart=/usr/bin/tailscale cert --cert-file ${CERT_DIR}/${DOMAIN}.crt --key-file ${CERT_DIR}/${DOMAIN}.key ${DOMAIN}
ExecStartPost=+/usr/bin/chown root:caddy ${CERT_DIR}/${DOMAIN}.crt ${CERT_DIR}/${DOMAIN}.key
ExecStartPost=+/usr/bin/chmod 640 ${CERT_DIR}/${DOMAIN}.crt ${CERT_DIR}/${DOMAIN}.key
ExecStartPost=+/usr/bin/bash -lc '/usr/bin/caddy reload --config ${CADDYFILE} --address ${CADDY_ADMIN} >/dev/null 2>&1 || /usr/bin/systemctl restart caddy'
EOF

cat > /etc/systemd/system/caddy-cert-renewal.timer <<'EOF'
[Unit]
Description=Daily Caddy TLS certificate renewal

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
run_quiet caddy validate --config "$CADDYFILE"
systemctl enable --now caddy
systemctl enable --now caddy-cert-renewal.timer

if [ -n "$SITE_NAME" ]; then
	"$HELPER" apply "$SITE_NAME" "$BASE_PATH" "$BIND_ADDR" "$PORT"
fi

echo "Bootstrap complete for $DOMAIN"
REMOTE_BOOTSTRAP

REMOTE_BOOTSTRAP_PATH="$(ssh "${SSH_BASE_OPTS[@]}" "${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}" "sh -lc 'mktemp /tmp/podman-deploy-init.XXXXXX'")"
scp "${SSH_BASE_OPTS[@]}" "$REMOTE_BOOTSTRAP_LOCAL" "${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}:${REMOTE_BOOTSTRAP_PATH}" >/dev/null

REMOTE_FAILLOCK_COUNT="$(podman_remote_faillock_count)"
if [[ "$REMOTE_FAILLOCK_COUNT" =~ ^[0-9]+$ ]] && [ "$REMOTE_FAILLOCK_COUNT" -ge 3 ]; then
	echo "ERROR: remote sudo for ${PODMAN_SSH_USER} is temporarily locked after ${REMOTE_FAILLOCK_COUNT} failed attempts." >&2
	echo "Reset it from an existing root session with 'faillock --user ${PODMAN_SSH_USER} --reset', or wait for the lockout to expire, then rerun podman-deploy --init." >&2
	exit 1
fi

if [ -n "$BOOTSTRAP_SUDO_PASSWORD" ]; then
	if ssh "${SSH_BASE_OPTS[@]}" "${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}" sudo -n true >/dev/null 2>&1; then
		podman_run_remote_bootstrap_without_password
	else
		if ! podman_run_remote_bootstrap_with_password "$BOOTSTRAP_SUDO_PASSWORD"; then
			status=$?
			BOOTSTRAP_SUDO_PASSWORD=""
			if [ "$status" -eq 10 ]; then
				echo "ERROR: provided sudo password was rejected by the remote host." >&2
				REMOTE_FAILLOCK_COUNT="$(podman_remote_faillock_count)"
				if [[ "$REMOTE_FAILLOCK_COUNT" =~ ^[0-9]+$ ]] && [ "$REMOTE_FAILLOCK_COUNT" -ge 3 ]; then
					echo "ERROR: remote sudo for ${PODMAN_SSH_USER} is now locked after repeated failures." >&2
					echo "Reset it from an existing root session with 'faillock --user ${PODMAN_SSH_USER} --reset', or wait for the lockout to expire, then rerun podman-deploy --init." >&2
				fi
				exit 1
			fi
			exit "$status"
		fi
	fi
	BOOTSTRAP_SUDO_PASSWORD=""
elif [ -t 0 ]; then
	if ssh "${SSH_BASE_OPTS[@]}" "${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}" sudo -n true >/dev/null 2>&1; then
		podman_run_remote_bootstrap_without_password
	else
		authenticated=""
		for attempt in 1 2 3; do
			podman_prompt_masked_secret "[podman-deploy --init] sudo password for ${PODMAN_SSH_USER} on ${PODMAN_TAILSCALE_HOST}: "
			PASSWORD_INPUT=$REPLY
			REPLY=""

			if podman_run_remote_bootstrap_with_password "$PASSWORD_INPUT"; then
				PASSWORD_INPUT=""
				authenticated=1
				break
			fi

			status=$?
			PASSWORD_INPUT=""
			if [ "$status" -ne 10 ]; then
				exit "$status"
			fi

			REMOTE_FAILLOCK_COUNT="$(podman_remote_faillock_count)"
			if [[ "$REMOTE_FAILLOCK_COUNT" =~ ^[0-9]+$ ]] && [ "$REMOTE_FAILLOCK_COUNT" -ge 3 ]; then
				echo "ERROR: remote sudo for ${PODMAN_SSH_USER} is now locked after repeated failures." >&2
				echo "Reset it from an existing root session with 'faillock --user ${PODMAN_SSH_USER} --reset', or wait for the lockout to expire, then rerun podman-deploy --init." >&2
				exit 1
			fi

			if [ "$attempt" -lt 3 ]; then
				echo "Incorrect sudo password. Try again." >&2
			fi
		done

		if [ -z "$authenticated" ]; then
			echo "ERROR: remote sudo authentication failed after 3 attempts." >&2
			exit 1
		fi
	fi
else
	if ! ssh "${SSH_BASE_OPTS[@]}" "${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}" sudo -n true >/dev/null 2>&1; then
		echo "ERROR: remote sudo requires an interactive terminal for password entry." >&2
		echo "Run podman-deploy --init from a local terminal, or clear any remote sudo lockout first." >&2
		exit 1
	fi

	podman_run_remote_bootstrap_without_password
fi

if [ -n "$HOST_ONLY" ]; then
	echo "Done → host ready at https://${PODMAN_DOMAIN}"
else
	echo "Done → ${ORIGIN}"
fi
