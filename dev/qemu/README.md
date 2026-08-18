# windows-qemu operator

`wq` is the only public interface for dockur/windows Quadlet guests
(`windows@01`, `windows@02`, …).

## Locations

```text
implementation: ~/.local/share/scripts/dev/qemu
command:        ~/.local/bin/wq
skill:          ~/.agents/skills/windows-qemu
quadlet:        ~/.config/containers/systemd/windows@.container
```

`~/.local/bin/wq` points at this directory's `wq` launcher.

Do not call the individual `*.py` files from systemd, the skill, or chat.
Do not keep a second copy under the skill or Quadlet `.agents/`.
systemd must call this directory's `wq`, not `~/.local/bin/wq`.
Guest originals live in `guest/` and are copied only by `wq` commands.

## Commands

```bash
wq doctor
wq resolve --all
wq resolve 02
wq status 02
wq restart 02
wq host-ssh 02
wq ssh-forward 02
wq ssh-setup 02
wq ssh-probe 02
wq exit-node 02 --check
wq install-exit-node 02
wq desktop-exit-off 02
wq cache-debloat
wq debloat 02
wq verify-debloat 02
wq stage
wq keys 02 run C:/Users/Docker/Desktop/Shared/scripts/windows-setup/setup-ssh.bat
```

`windows@.service` `ExecStartPost` runs `{scriptsDir}/wq ssh-forward %i`.
Restart guests only with `wq restart {id}` or `systemctl --user restart windows@{id}`.
Never `podman restart`.
