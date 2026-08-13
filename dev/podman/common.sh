#!/usr/bin/env bash

podman_load_context() {
	local project_dir=$1
	local project_optional=${2:-0}

	PROJECT_DIR="$(cd "$project_dir" && pwd)"

	DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
	GLOBAL_CONF="$DATA_HOME/scripts/dev/podman-deploy.conf"
	if [ ! -f "$GLOBAL_CONF" ]; then
		echo "Error: $GLOBAL_CONF not found" >&2
		return 1
	fi

	set -a
	# shellcheck disable=SC1090
	source "$GLOBAL_CONF"
	set +a

	PROJECT_ENV="$PROJECT_DIR/.env"
	if [ -f "$PROJECT_ENV" ]; then
		set -a
		# shellcheck disable=SC1090
		source "$PROJECT_ENV"
		set +a
	fi

	: "${PODMAN_SSH_HOST:?set PODMAN_SSH_HOST in $GLOBAL_CONF}"
	: "${PODMAN_TAILSCALE_DOMAIN:?set PODMAN_TAILSCALE_DOMAIN in $GLOBAL_CONF}"

	PODMAN_SSH_USER="${PODMAN_SSH_USER:-$USER}"
	PODMAN_IMAGE_NAME="${PODMAN_IMAGE_NAME:-}"
	if [ -z "$PODMAN_IMAGE_NAME" ] && { [ "$project_optional" = "0" ] || [ -f "$PROJECT_DIR/package.json" ]; }; then
		if [ -f "$PROJECT_DIR/package.json" ] && command -v jq &>/dev/null; then
			PODMAN_IMAGE_NAME="$(jq -r .name "$PROJECT_DIR/package.json")"
		fi
		PODMAN_IMAGE_NAME="${PODMAN_IMAGE_NAME:-${PROJECT_DIR##*/}}"
	fi

	if [ -n "${PODMAN_BASE_PATH:-}" ] && [[ "${PODMAN_BASE_PATH}" != /* ]]; then
		echo "Error: PODMAN_BASE_PATH must start with '/' when set" >&2
		return 1
	fi

	PODMAN_PORT="${PODMAN_PORT:-3000}"
	PODMAN_BIND_ADDR="${PODMAN_BIND_ADDR:-127.0.0.1}"
	if [ -z "${PODMAN_BASE_PATH+x}" ]; then
		if [ -n "${PODMAN_IMAGE_NAME:-}" ]; then
			PODMAN_BASE_PATH="/${PODMAN_IMAGE_NAME}"
		else
			PODMAN_BASE_PATH=""
		fi
	fi

	SSH_BASE_OPTS=(
		-o ConnectTimeout=5
	)

	PODMAN_TAILSCALE_HOST="${PODMAN_TAILSCALE_HOST:-}"
	if [ -z "$PODMAN_TAILSCALE_HOST" ]; then
		PODMAN_TAILSCALE_HOST="$(ssh "${SSH_BASE_OPTS[@]}" "${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}" hostname -s 2>/dev/null || echo "")"
		if [ -z "$PODMAN_TAILSCALE_HOST" ]; then
			case "$PODMAN_SSH_HOST" in
				*.*)
					PODMAN_TAILSCALE_HOST="${PODMAN_SSH_HOST%%.*}"
					if [[ "$PODMAN_TAILSCALE_HOST" =~ ^[0-9]+$ ]]; then
						PODMAN_TAILSCALE_HOST=""
					fi
					;;
			esac
		fi
		if [ -z "$PODMAN_TAILSCALE_HOST" ] && command -v tailscale &>/dev/null && command -v jq &>/dev/null; then
			PODMAN_TAILSCALE_HOST="$({ tailscale status --json 2>/dev/null || echo '{}'; } |
				jq -r --arg host "$PODMAN_SSH_HOST" '
					first(
						.Peer
						| to_entries[]?
						| select(
							((.value.TailscaleIPs // []) | index($host))
							or ((.value.DNSName // "") == $host)
							or (((.value.DNSName // "") | sub("\\.$"; "")) == $host)
						)
						| (.value.DNSName // empty)
					) // empty
					| sub("\\.$"; "")
					| split(".")[0]
				' )"
		fi
		: "${PODMAN_TAILSCALE_HOST:?could not derive TAILSCALE_HOST from remote; set PODMAN_TAILSCALE_HOST in $GLOBAL_CONF}"
	fi

	if [[ "$PODMAN_SSH_HOST" =~ ^[0-9a-fA-F:.]+$ ]] && command -v tailscale &>/dev/null; then
		SSH_BASE_OPTS+=(
			-o ProxyCommand=tailscale\ nc\ ${PODMAN_SSH_HOST}\ %p
			-o HostKeyAlias=${PODMAN_TAILSCALE_HOST}.${PODMAN_TAILSCALE_DOMAIN}
		)
	fi

	PODMAN_DOMAIN="${PODMAN_TAILSCALE_HOST}.${PODMAN_TAILSCALE_DOMAIN}"
	if [ -n "${PODMAN_BASE_PATH}" ]; then
		ORIGIN="https://${PODMAN_DOMAIN}${PODMAN_BASE_PATH}"
	else
		ORIGIN="https://${PODMAN_DOMAIN}:${PODMAN_PORT}"
	fi
}

podman_init_ssh_transport() {
	local key=${1:-${PODMAN_IMAGE_NAME:-host}}

	SSH_DEST="${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}"
	SSH_CTRL="/tmp/podman-deploy-ssh-%r@%h:%p.${key}"
	CTRL_OPTS=(
		-o ControlMaster=auto
		-o ControlPath="${SSH_CTRL}"
		-o ControlPersist=300
		"${SSH_BASE_OPTS[@]}"
	)
}

podman_remote() {
	ssh "${CTRL_OPTS[@]}" "$SSH_DEST" "$@"
}

podman_close_ssh_transport() {
	if [ -n "${SSH_DEST:-}" ] && [ -n "${SSH_CTRL:-}" ]; then
		ssh -O exit "${CTRL_OPTS[@]}" "$SSH_DEST" 2>/dev/null || true
	fi
}

podman_warm_ssh_transport() {
	ssh -fN "${CTRL_OPTS[@]}" "$SSH_DEST" 2>/dev/null || true
}

podman_build_caddy_snippet() {
	local base_path=${1:-$PODMAN_BASE_PATH}
	local bind_addr=${2:-$PODMAN_BIND_ADDR}
	local port=${3:-$PODMAN_PORT}

	if [ -n "$base_path" ]; then
		cat <<EOF
reverse_proxy ${base_path}* ${bind_addr}:${port} {
    header_up X-Forwarded-Proto https
}
EOF
	else
		cat <<EOF
reverse_proxy ${bind_addr}:${port} {
    header_up X-Forwarded-Proto https
}
EOF
	fi
}

podman_named_volume_sources() {
	local volume
	for volume in ${PODMAN_VOLUMES:-}; do
		local source=${volume%%:*}
		if [[ "$source" != */* ]] && [[ "$source" != .* ]] && [ -n "$source" ]; then
			printf '%s\n' "$source"
		fi
	done
}
