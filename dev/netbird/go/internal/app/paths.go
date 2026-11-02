// paths.go holds the constants and locations netbird-setup.py computed from
// __file__: the module's own directory (dev/netbird), its parent (dev), the
// key file, and the cached Windows MSI.
package app

import (
	"os"
	"path/filepath"
)

// RootEnv names the directory the wrapper exports: dev/netbird, which holds
// windows/, README.md, and the key file. The Python original derived it from
// __file__; a compiled binary reads it instead.
const RootEnv = "NETBIRD_SETUP_ROOT"

const (
	KeysName             = ".env.netbird.setup.keys"
	MSIName              = "netbird_installer_windows_amd64.msi"
	MSIURL               = "https://pkgs.netbird.io/windows/msi/x64"
	DefaultManagementURL = "https://management.example.invalid"
	DefaultAutoGroup     = "employees"
	DefaultExpiresIn     = 604800
	DefaultUsageLimit    = 1
	USBPayloadDir        = "netbird-setup"
	WindowsPS1Name       = "install-netbird.ps1"
	WindowsCMDName       = "install-netbird.cmd"
	WindowsReadmeName    = "README.md"
	oldKeyPrefix         = "NETBIRD_SETUP_KEY_"
)

// Paths is SCRIPT_DIR/DEV_DIR and everything derived from them.
type Paths struct {
	ScriptDir  string // dev/netbird
	DevDir     string // dev
	ConfigPath string // dev/.env.netbird
	KeysPath   string // dev/netbird/.env.netbird.setup.keys
	MSICache   string // dev/netbird/.data/netbird_installer_windows_amd64.msi
	WindowsDir string // dev/netbird/windows
}

// pathsFromRoot builds Paths for a dev/netbird directory.
func pathsFromRoot(root string) Paths {
	dev := filepath.Dir(root)
	return Paths{
		ScriptDir:  root,
		DevDir:     dev,
		ConfigPath: filepath.Join(dev, ".env.netbird"),
		KeysPath:   filepath.Join(root, KeysName),
		MSICache:   filepath.Join(root, ".data", MSIName),
		WindowsDir: filepath.Join(root, "windows"),
	}
}

// defaultPaths reads NETBIRD_SETUP_ROOT, falling back to the Python layout
// under $HOME/.local/share/scripts.
func defaultPaths(getenv func(string) string) Paths {
	if root := getenv(RootEnv); root != "" {
		return pathsFromRoot(root)
	}
	return pathsFromRoot(filepath.Join(homeDir(getenv), ".local", "share", "scripts", "dev", "netbird"))
}

func homeDir(getenv func(string) string) string {
	if home := getenv("HOME"); home != "" {
		return home
	}
	if home, err := os.UserHomeDir(); err == nil {
		return home
	}
	return "/"
}
