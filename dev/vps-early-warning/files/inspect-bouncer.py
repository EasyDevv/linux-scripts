#!/usr/bin/python3
from pathlib import Path

files = [
    Path("/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml"),
    Path("/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml.local"),
]
hide_prefixes = ("api_key", "lapi")
for path in files:
    print("FILE", path.name, path.exists())
    if not path.exists():
        continue
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key = stripped.split(":", 1)[0].strip()
        if key in hide_prefixes or key.endswith("_key"):
            print(" field_hidden")
            continue
        print(line)
