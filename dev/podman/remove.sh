#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

usage() {
	cat <<'EOF'
Usage: podman-deploy --remove [--keep-image] [--prune-volume] [--skip-caddy] [project-dir]

Remove a previously deployed Podman app from the remote host.

Options:
  --keep-image    Keep localhost/<app>:latest on the remote host
  --prune-volume  Remove named Podman volumes declared by PODMAN_VOLUMES
  --skip-caddy    Keep the remote Caddy snippet in place

By default this removes:
  - the user Quadlet file
  - the running container/service
  - the remote OCI transfer directory
  - the app-specific Caddy snippet

It keeps named volumes unless --prune-volume is set.
EOF
}

KEEP_IMAGE=""
PRUNE_VOLUME=""
SKIP_CADDY=""
PROJECT_DIR="."
for arg in "$@"; do
	case "$arg" in
		--keep-image) KEEP_IMAGE=1 ;;
		--prune-volume) PRUNE_VOLUME=1 ;;
		--skip-caddy) SKIP_CADDY=1 ;;
		-h|--help) usage; exit 0 ;;
		-*) echo "Unknown option: $arg" >&2; usage >&2; exit 1 ;;
		*) PROJECT_DIR="$arg" ;;
	esac
done

podman_load_context "$PROJECT_DIR"
PODMAN_VOLUMES="${PODMAN_VOLUMES:-${PODMAN_IMAGE_NAME}-data:/app/data}"
PODMAN_STOP_TIMEOUT="${PODMAN_STOP_TIMEOUT:-3}"

echo "──────────────────────────────"
echo " project:   $PROJECT_DIR"
echo " image:     $PODMAN_IMAGE_NAME"
echo " remote:    ${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}"
echo " keep-img:  $(if [ -n "$KEEP_IMAGE" ]; then printf 'yes'; else printf 'no'; fi)"
echo " prune-vol: $(if [ -n "$PRUNE_VOLUME" ]; then printf 'yes'; else printf 'no'; fi)"
echo " skip-cdy:  $(if [ -n "$SKIP_CADDY" ]; then printf 'yes'; else printf 'no'; fi)"
echo "──────────────────────────────"

podman_init_ssh_transport "$PODMAN_IMAGE_NAME"
cleanup() {
	podman_close_ssh_transport
}
trap cleanup EXIT INT TERM
podman_warm_ssh_transport

REMOTE_DIR="\$HOME/${PODMAN_IMAGE_NAME}"
VOLUME_REMOVE_LINES=""
if [ -n "$PRUNE_VOLUME" ]; then
	while IFS= read -r volume_source; do
		[ -n "$volume_source" ] || continue
		VOLUME_REMOVE_LINES+="podman volume rm -f ${volume_source} &>/dev/null || true
"
	done < <(podman_named_volume_sources)
fi

echo "=== Remove Runtime ==="
podman_remote bash -s <<REMOTE_CMD
set -euo pipefail

systemctl --user disable --now ${PODMAN_IMAGE_NAME} &>/dev/null || true
systemctl --user stop container-${PODMAN_IMAGE_NAME} &>/dev/null || true
podman rm -f -t ${PODMAN_STOP_TIMEOUT} ${PODMAN_IMAGE_NAME} &>/dev/null || true

rm -f \$HOME/.config/containers/systemd/${PODMAN_IMAGE_NAME}.container
rm -f \$HOME/.config/systemd/user/container-${PODMAN_IMAGE_NAME}.service
rm -f \$HOME/.config/systemd/user/default.target.wants/container-${PODMAN_IMAGE_NAME}.service
systemctl --user daemon-reload
systemctl --user reset-failed &>/dev/null || true

rm -rf ${REMOTE_DIR}

if [ -z "${KEEP_IMAGE}" ]; then
	podman rmi -f localhost/${PODMAN_IMAGE_NAME}:latest &>/dev/null || true
fi

${VOLUME_REMOVE_LINES}:
REMOTE_CMD

if [ -n "$SKIP_CADDY" ]; then
	echo "=== Remove Caddy ==="
	echo "  skipped: requested by --skip-caddy"
else
	echo "=== Remove Caddy ==="
	if ! podman_remote sudo -n /usr/local/bin/podman-sync-caddy-site remove "${PODMAN_IMAGE_NAME}"; then
		echo "ERROR: remote Caddy cleanup failed. Remove /etc/caddy/conf.d/${PODMAN_IMAGE_NAME}.caddy manually or rerun podman-deploy --init." >&2
		exit 1
	fi
fi

echo "Done → removed ${PODMAN_IMAGE_NAME} from ${PODMAN_DOMAIN}"
