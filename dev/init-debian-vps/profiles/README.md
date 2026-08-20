# Runtime profiles

`*.example.json` files are redacted templates intended for version control. The
runtime profile names are deliberately ignored because they contain deployment
identifiers, network addresses, employee data, and local access policy.

Create local runtime files from the templates:

```sh
cd ~/.local/share/scripts/dev/init-debian-vps
for example in profiles/*.example.json; do
  cp "$example" "${example%.example.json}.json"
done
```

Then replace every `example.invalid`, reserved documentation IP, placeholder
UUID, peer name, employee address, and key label with local values. Keep these
files uncommitted. The generated `.env.netbird.setup.keys`, OVH credential
file, SSH private key, and sender environment file must also remain outside the
repository.

Verify that a runtime profile is ignored before using it:

```sh
git check-ignore -v profiles/ovh-vps.json
```
