#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage: podman-deploy [--init | --remove] [options] [project-dir]

Modes:
  default   Deploy or update the current project
  --init    Bootstrap remote host resources and optional project route
  --remove  Remove the deployed project from the remote host

Shared:
  -h, --help    Show this help

Deploy options:
  -f, --force   Skip no-change detection, force full deploy
  --skip-caddy  Skip remote Caddy snippet sync

Init options:
  --host-only   Prepare only host-level Caddy/Tailscale state

Remove options:
  --keep-image    Keep localhost/<app>:latest on the remote host
  --prune-volume  Remove named Podman volumes declared by PODMAN_VOLUMES
  --skip-caddy    Keep the remote Caddy snippet in place
EOF
}

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
PODMAN_DIR="$SCRIPT_DIR/podman"

MODE="deploy"
PASSTHRU=()
for arg in "$@"; do
	case "$arg" in
		--init)
			if [ "$MODE" != "deploy" ]; then
				echo "Error: --init and --remove cannot be combined" >&2
				exit 1
			fi
			MODE="init"
			;;
		--remove)
			if [ "$MODE" != "deploy" ]; then
				echo "Error: --init and --remove cannot be combined" >&2
				exit 1
			fi
			MODE="remove"
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			PASSTHRU+=("$arg")
			;;
	esac
done

case "$MODE" in
	deploy) exec "$PODMAN_DIR/deploy.sh" "${PASSTHRU[@]}" ;;
	init) exec "$PODMAN_DIR/init.sh" "${PASSTHRU[@]}" ;;
	remove) exec "$PODMAN_DIR/remove.sh" "${PASSTHRU[@]}" ;;
esac
