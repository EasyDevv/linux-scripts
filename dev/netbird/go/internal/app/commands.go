// commands.go ports issue / usb / list / employees. Output goes to the writer
// fields, so the tests drive them like the Python unittest did with StringIO.
package app

import (
	"io"
	"os"
	"path/filepath"
	"strings"

	"netbird-setup/internal/ui"
)

// App is the command layer's dependencies: streams, TTY flags, paths, and the
// seams the tests replace (key minting, lsblk, the MSI fetch, the picker).
type App struct {
	Paths  Paths
	In     io.Reader
	Out    io.Writer
	Err    io.Writer
	InTTY  bool
	ErrTTY bool
	Getenv func(string) string

	// Create mints a setup key; nil means the real management API.
	Create func(config Config, name string) (string, error)
	// Volumes overrides USB discovery (nil means run lsblk).
	Volumes *[]UsbVolume
	// EnsureMSI overrides the MSI step; nil means ensureMSI.
	EnsureMSI func(destDir string) (string, bool)
	// Pick overrides the UI; nil means the Bubble Tea picker on the terminal.
	Pick func(title string, choices []ui.Choice) (ui.Choice, bool, error)
	// Prompt overrides the hidden key-name prompt.
	Prompt func() (string, error)
}

// creator returns the minting seam, defaulting to the management API.
func (a *App) creator(config Config) func(Config, string) (string, error) {
	if a.Create != nil {
		return a.Create
	}
	return func(cfg Config, name string) (string, error) {
		return createSetupKey(cfg, name, defaultRequest(cfg))
	}
}

// Interactive reports whether both stdin and stderr are terminals.
func (a *App) Interactive() bool { return a.InTTY && a.ErrTTY }

// pick runs the picker, or its test override.
func (a *App) pick(title string, choices []ui.Choice) (ui.Choice, bool, error) {
	if a.Pick != nil {
		return a.Pick(title, choices)
	}
	return ui.Pick(title, choices, ui.ColorEnabled(a.Err), a.In, a.Err)
}

// promptName runs the hidden key-name prompt, or its test override.
func (a *App) promptName() (string, error) {
	if a.Prompt != nil {
		return a.Prompt()
	}
	return ui.PromptSecret(NamePrompt, a.In, a.Err)
}

// NamePrompt is the original's key-name prompt text.
const NamePrompt = "Key name (e.g. GREEN_USER_01): "

// resolveName ports resolve_name(): an explicit NAME, a picker over stored
// names, or a typed name. Non-TTY without NAME is an error.
func (a *App) resolveName(raw string, names []string) (string, error) {
	if raw != "" {
		return normalizeKeyName(raw)
	}
	if !a.Interactive() {
		return "", newError("NAME is required when stdin is not a TTY")
	}
	if len(names) > 0 {
		choices := make([]ui.Choice, 0, len(names))
		for _, name := range names {
			choices = append(choices, ui.Choice{ID: name, Label: name, Color: ui.ColorCyan})
		}
		choice, chosen, err := a.pick("Select setup key", choices)
		if err != nil {
			return "", err
		}
		if !chosen {
			return "", errAborted()
		}
		return choice.ID, nil
	}
	typed, err := a.promptName()
	if err != nil {
		return "", err
	}
	typed = strings.TrimSpace(typed)
	if typed == "" {
		return "", newError("key name is required")
	}
	return normalizeKeyName(typed)
}

// confirmNo is confirm_no(): a two-row picker, No first and dim, Yes red.
func (a *App) confirmNo(question string) (bool, error) {
	choice, chosen, err := a.pick(question, []ui.Choice{
		{ID: "no", Label: "No", Color: ui.ColorDim},
		{ID: "yes", Label: "Yes", Color: ui.ColorRed},
	})
	if err != nil {
		return false, err
	}
	return chosen && choice.ID == "yes", nil
}

// Issue ports cmd_issue().
func (a *App) Issue(name string, replace bool) error {
	config, err := loadConfig(a.Getenv, a.Paths, a.Paths.KeysPath, true)
	if err != nil {
		return err
	}
	resolved, err := a.resolveName(name, nil)
	if err != nil {
		return err
	}
	existing := loadEnvFile(config.KeysPath)
	if existing[resolved] != "" && !replace {
		if a.Interactive() {
			ok, err := a.confirmNo(resolved + " already exists. Replace it?")
			if err != nil {
				return err
			}
			if !ok {
				return errAborted()
			}
		} else {
			return newError(resolved + " already exists; pass --replace")
		}
	}
	key, err := a.creator(config)(config, resolved)
	if err != nil {
		return err
	}
	saved, err := saveSetupKey(config, resolved, key)
	if err != nil {
		return err
	}
	writeLine(a.Out, "issued "+resolved+" (one-off, "+config.AutoGroup+", 7d) -> "+saved)
	return nil
}

// USB ports cmd_usb().
func (a *App) USB(dest string) error {
	config, err := loadConfig(a.Getenv, a.Paths, a.Paths.KeysPath, false)
	if err != nil {
		return err
	}
	names := listKeyNames(config.KeysPath)
	if len(names) == 0 {
		return newError("no setup keys; run netbird-setup issue NAME first")
	}
	destRoot, err := a.resolveUSBDest(dest)
	if err != nil {
		return err
	}
	payload := payloadDir(destRoot)
	if err := os.MkdirAll(payload, 0o755); err != nil {
		return newError("destination is not a writable directory: " + payload)
	}
	written, err := writeUSBpayload(a.Paths, payload, config.KeysPath)
	if err != nil {
		return err
	}
	ensure := a.EnsureMSI
	if ensure == nil {
		ensure = func(dir string) (string, bool) {
			return ensureMSI(a.Paths, dir, MSIURL, nil)
		}
	}
	installer, ok := ensure(payload)
	if !ok {
		writeLine(a.Err, "warning: Windows MSI download failed; the USB script will use winget")
	}
	for _, path := range written {
		writeLine(a.Out, "wrote "+path)
	}
	if ok {
		writeLine(a.Out, "wrote "+installer)
	}
	return nil
}

// List ports cmd_list(): names only, never values.
func (a *App) List() error {
	names := listKeyNames(a.Paths.KeysPath)
	if len(names) == 0 {
		writeLine(a.Out, "no setup keys")
		return nil
	}
	for _, name := range names {
		writeLine(a.Out, name)
	}
	return nil
}

// Employees ports cmd_employees(): plan, then mint only the missing names.
func (a *App) Employees(rosterPath, autoGroup string, apply bool) error {
	names, keysPath, err := loadEmployeeRoster(a.Paths, expandHome(rosterPath))
	if err != nil {
		return err
	}
	config, err := loadConfig(a.Getenv, a.Paths, keysPath, true)
	if err != nil {
		return err
	}
	if autoGroup != "" {
		config.AutoGroup = autoGroup
	}
	existing := loadEnvFile(keysPath)
	missing := make([]string, 0, len(names))
	for _, name := range names {
		if existing[name] == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) == 0 {
		writeLine(a.Out, "PASS employee keys already stored ("+itoa(int64(len(names)))+")")
		return nil
	}
	for _, name := range missing {
		writeLine(a.Out, "PLAN mint employee key "+name)
	}
	if !apply {
		return nil
	}
	create := a.creator(config)
	for _, name := range missing {
		key, err := create(config, name)
		if err != nil {
			return err
		}
		if _, err := saveSetupKey(config, name, key); err != nil {
			return err
		}
		writeLine(a.Out, "CHANGE minted "+name+" (one-off, "+config.AutoGroup+", 7d)")
	}
	writeLine(a.Out, "PASS wrote "+filepath.Base(keysPath)+" without printing secrets")
	return nil
}

// resolveUSBDest ports resolve_usb_dest().
func (a *App) resolveUSBDest(raw string) (string, error) {
	if raw != "" {
		dest := resolvePath(raw)
		if !isWritableDir(dest) {
			return "", newError("destination is not a writable directory: " + dest)
		}
		return dest, nil
	}
	if !a.Interactive() {
		return "", newError("--dest is required when stdin is not a TTY")
	}
	volumes, err := a.usbVolumes()
	if err != nil {
		return "", err
	}
	if len(volumes) == 0 {
		return "", newError("no mounted USB storage; mount one or pass --dest PATH")
	}
	choices := make([]ui.Choice, 0, len(volumes))
	for _, volume := range volumes {
		choices = append(choices, ui.Choice{
			ID:    volume.ChoiceID(),
			Label: volume.ChoiceLabel(),
			Color: ui.ColorGreen,
		})
	}
	choice, chosen, err := a.pick("Select USB storage", choices)
	if err != nil {
		return "", err
	}
	if !chosen {
		return "", errAborted()
	}
	if !isWritableDir(choice.ID) {
		return "", newError("destination is not a writable directory: " + choice.ID)
	}
	return choice.ID, nil
}

// usbVolumes returns injected volumes or runs lsblk.
func (a *App) usbVolumes() ([]UsbVolume, error) {
	if a.Volumes != nil {
		return *a.Volumes, nil
	}
	return listUsbVolumes("")
}

// writeLine writes one line, ignoring short writes like sys.stdout.write did.
func writeLine(w io.Writer, line string) {
	if w == nil {
		return
	}
	_, _ = io.WriteString(w, line+"\n")
}
