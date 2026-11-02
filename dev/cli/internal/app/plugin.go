// plugin.go ports cli-rust/src/plugin.rs (proto plugin TOML and .protolock sha256).

package app

import (
	"fmt"
	"strings"

	"github.com/BurntSushi/toml"
)

// pluginRender is plugin::render. Named with a prefix because audit::render is also render in this package.
// tag is the release tag (v1.2.3 or 1.2.3); vendor ignores it.
func pluginRender(tool *Tool, version string, tag *string) (string, error) {
	if tool.Bin == nil {
		return "", fmt.Errorf("missing bin")
	}
	bin := *tool.Bin
	exe := tool.ExeName()
	var out strings.Builder
	fmt.Fprintf(&out, "name = %s\ntype = \"cli\"\n\n", quote(tool.Name))
	fmt.Fprintf(&out, "[resolve]\nversions = [%s]\n\n", quote(version))
	switch tool.Method {
	case MethodRelease:
		if tool.Repo == nil {
			return "", fmt.Errorf("missing repo")
		}
		if tag == nil {
			return "", fmt.Errorf("missing release tag")
		}
		template := strings.ReplaceAll(*tag, version, "{version}")
		if !strings.Contains(template, "{version}") {
			return "", fmt.Errorf("release tag %s does not contain version %s", *tag, version)
		}
		if tool.Asset == nil {
			return "", fmt.Errorf("missing asset")
		}
		if tool.Checksum == nil {
			return "", fmt.Errorf("missing checksum")
		}
		base := fmt.Sprintf("https://github.com/%s/releases/download/%s", *tool.Repo, template)
		fmt.Fprintf(&out, "[install]\ndownload-url = %s\nchecksum-url = %s\n\n",
			quote(base+"/{download_file}"),
			quote(base+"/{checksum_file}"),
		)
		fmt.Fprintf(&out, "[install.exes.%s]\nprimary = true\n\n", quote(exe))
		fmt.Fprintf(&out, "[platform.linux]\ndownload-file = %s\nchecksum-file = %s\nexe-path = %s\n",
			quote(*tool.Asset),
			quote(*tool.Checksum),
			quote(bin),
		)
	case MethodVendor:
		if tool.URL == nil {
			return "", fmt.Errorf("missing url")
		}
		slash := strings.LastIndex(*tool.URL, "/")
		if slash < 0 {
			return "", fmt.Errorf("invalid url")
		}
		dir := (*tool.URL)[:slash]
		file := (*tool.URL)[slash+1:]
		fmt.Fprintf(&out, "[install]\ndownload-url = %s\n\n", quote(dir+"/{download_file}"))
		fmt.Fprintf(&out, "[install.exes.%s]\nprimary = true\n\n", quote(exe))
		fmt.Fprintf(&out, "[platform.linux]\ndownload-file = %s\nexe-path = %s\n", quote(file), quote(bin))
	default:
		return "", fmt.Errorf("%s is not installed through a proto plugin", methodDebug(tool.Method))
	}
	return out.String(), nil
}

func methodDebug(method Method) string {
	switch method {
	case MethodRelease:
		return "Release"
	case MethodVendor:
		return "Vendor"
	case MethodBun:
		return "Bun"
	case MethodGo:
		return "Go"
	case MethodCargo:
		return "Cargo"
	default:
		return fmt.Sprintf("Method(%d)", int(method))
	}
}

func quote(value string) string {
	var out strings.Builder
	out.WriteByte('"')
	for _, ch := range value {
		switch ch {
		case '"':
			out.WriteString(`\"`)
		case '\\':
			out.WriteString(`\\`)
		case '\n':
			out.WriteString(`\n`)
		default:
			out.WriteRune(ch)
		}
	}
	out.WriteByte('"')
	return out.String()
}

// protolockSha256 is protolock_sha256. The bool is false when the record or a
// 64-hex sha256 is absent, including invalid TOML. Checksum forms are
// sha256:<hex> and gpg:<fp>:sha256:<hex>. A matching version whose checksum
// key is missing or not a string stops the search (Rust's Option ?).
func protolockSha256(lockText, name, version string) (string, bool) {
	var root map[string]any
	if err := toml.Unmarshal([]byte(lockText), &root); err != nil {
		return "", false
	}
	tools, ok := root["tools"].(map[string]any)
	if !ok {
		return "", false
	}
	raw, ok := tools[name]
	if !ok {
		return "", false
	}
	records, ok := raw.([]map[string]any)
	if !ok {
		return "", false
	}
	for _, record := range records {
		got, _ := record["version"].(string)
		if got != version {
			continue
		}
		rawChecksum, present := record["checksum"]
		if !present {
			return "", false
		}
		checksum, ok := rawChecksum.(string)
		if !ok {
			return "", false
		}
		hash, ok := sha256Tail(checksum)
		if ok {
			return hash, true
		}
	}
	return "", false
}

func sha256Tail(checksum string) (string, bool) {
	idx := strings.LastIndex(checksum, "sha256:")
	if idx < 0 {
		return "", false
	}
	hash := checksum[idx+len("sha256:"):]
	if len(hash) != 64 || !isHex64(hash) {
		return "", false
	}
	return asciiLower(hash), true
}
