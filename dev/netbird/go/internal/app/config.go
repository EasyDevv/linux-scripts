// config.go ports load_config(): NETBIRD_* from the environment, then the
// dev/.env.netbird file, then the defaults. Only `issue` and `employees` need
// the PAT.
package app

import (
	"os"
	"strings"
)

// Config is the loaded runtime configuration.
type Config struct {
	APIKey        string
	ManagementURL string
	AutoGroup     string
	ConfigPath    string
	KeysPath      string
}

// AppError is the original's AppError: printed as `error: <msg>`, exit 1.
// Code overrides the exit code for the abort path (130).
type AppError struct {
	Msg  string
	Code int
}

func (e *AppError) Error() string { return e.Msg }

func newError(msg string) error { return &AppError{Msg: msg} }

// errAborted is the picker's `aborted`. The Python original reported it as a
// plain AppError (exit 1); the port exits 130 (README Changelog).
func errAborted() error { return &AppError{Msg: "aborted", Code: 130} }

// loadConfig resolves the configuration. requireAPIKey is false for `usb`,
// which only needs the keys file.
func loadConfig(getenv func(string) string, paths Paths, keysPath string, requireAPIKey bool) (Config, error) {
	get := func(key string) string {
		if getenv == nil {
			return os.Getenv(key)
		}
		return getenv(key)
	}
	fileValues := loadEnvFile(paths.ConfigPath)
	apiKey := firstNonEmpty(get("NETBIRD_API_KEY"), fileValues["NETBIRD_API_KEY"])
	managementURL := strings.TrimRight(firstNonEmpty(
		get("NETBIRD_MANAGEMENT_URL"),
		fileValues["NETBIRD_MANAGEMENT_URL"],
		DefaultManagementURL,
	), "/")
	autoGroup := firstNonEmpty(get("NETBIRD_AUTO_GROUP"), fileValues["NETBIRD_AUTO_GROUP"], DefaultAutoGroup)
	if requireAPIKey && apiKey == "" {
		configName := baseName(paths.ConfigPath)
		return Config{}, newError("NETBIRD_API_KEY is required; copy " + configName +
			".example to " + configName + " and set the PAT")
	}
	return Config{
		APIKey:        apiKey,
		ManagementURL: managementURL,
		AutoGroup:     autoGroup,
		ConfigPath:    paths.ConfigPath,
		KeysPath:      keysPath,
	}, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
