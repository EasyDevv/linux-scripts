// engine.go ports cli-rust/src/engine.rs (proto argv and external commands).
// Commands are argument arrays only. Inherited PROTO_*VERSION overrides are removed.

package app

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Proto runs proto with Paths.ProtoBin and cwd Paths.CliHome.
type Proto struct {
	Paths *Paths
}

// isInheritedOverride is is_inherited_override.
func isInheritedOverride(key string) bool {
	return key == "PROTO_VERSION" ||
		key == "PROTO_SHIM_NAME" ||
		key == "PROTO_SHIM_PATH" ||
		(strings.HasPrefix(key, "PROTO_") && strings.HasSuffix(key, "_VERSION"))
}

// pluginAddArgs is plugin_add_args. pluginFile is joined as file://{path} with no extra slash.
func pluginAddArgs(name, pluginFile string) []string {
	return []string{"-y", "-r", "text", "plugin", "add", name, "file://" + pluginFile, "--to", "global"}
}

// installArgs is install_args.
func installArgs(name, version string) []string {
	return []string{"-y", "-r", "text", "-c", "upwards-global", "install", name, version, "--pin", "global"}
}

// uninstallArgs is uninstall_args.
func uninstallArgs(name, version string) []string {
	return []string{"-y", "-r", "text", "-c", "upwards-global", "uninstall", name, version}
}

// pluginRemoveArgs is plugin_remove_args.
func pluginRemoveArgs(name string) []string {
	return []string{"-y", "-r", "text", "plugin", "remove", name, "--from", "global"}
}

// runExternal is run_external. Failure includes the last 8 lines of stderr then stdout.
// A start failure is "run {program}: ...". Exit failure is "{program} {args} failed:\n{tail}".
// Returns only error: pkg.go calls it as a single result. Stdout is discarded on success.
func runExternal(program string, args []string, cwd string, envs [][2]string) error {
	cmd := exec.Command(program, args...)
	cmd.Dir = cwd
	cmd.Env = commandEnv(envs)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err == nil {
		return nil
	}
	if _, ok := err.(*exec.ExitError); ok {
		text := stderr.String() + stdout.String()
		return fmt.Errorf("%s %s failed:\n%s", program, strings.Join(args, " "), lastOutputLines(text, 8))
	}
	return fmt.Errorf("run %s: %w", program, err)
}

func commandEnv(envs [][2]string) []string {
	base := os.Environ()
	out := make([]string, 0, len(base)+len(envs))
	for _, item := range base {
		key, _, _ := strings.Cut(item, "=")
		if isInheritedOverride(key) {
			continue
		}
		out = append(out, item)
	}
	for _, pair := range envs {
		prefix := pair[0] + "="
		filtered := make([]string, 0, len(out))
		for _, item := range out {
			if strings.HasPrefix(item, prefix) {
				continue
			}
			filtered = append(filtered, item)
		}
		out = append(filtered, prefix+pair[1])
	}
	return out
}

func lastOutputLines(text string, n int) string {
	lines := splitOutputLines(text)
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func splitOutputLines(text string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(text); i++ {
		switch text[i] {
		case '\n':
			lines = append(lines, strings.TrimSuffix(text[start:i], "\r"))
			start = i + 1
		case '\r':
			lines = append(lines, text[start:i])
			if i+1 < len(text) && text[i+1] == '\n' {
				i++
			}
			start = i + 1
		}
	}
	if start < len(text) {
		lines = append(lines, text[start:])
	}
	return lines
}

func (p Proto) run(args []string) error {
	return runExternal(p.Paths.ProtoBin, args, p.Paths.CliHome, nil)
}

// PluginAdd is Proto::plugin_add.
func (p Proto) PluginAdd(name, pluginFile string) error {
	return p.run(pluginAddArgs(name, pluginFile))
}

// Install is Proto::install.
func (p Proto) Install(name, version string) error {
	return p.run(installArgs(name, version))
}

// Uninstall is Proto::uninstall.
func (p Proto) Uninstall(name, version string) error {
	return p.run(uninstallArgs(name, version))
}

// PluginRemove is Proto::plugin_remove.
func (p Proto) PluginRemove(name string) error {
	return p.run(pluginRemoveArgs(name))
}
