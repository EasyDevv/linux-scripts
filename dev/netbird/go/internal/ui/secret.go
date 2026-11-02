// secret.go is the key-name prompt. Like the original's readline prompt, it
// echoes the typed name (a key name is a label, not a secret).
package ui

import (
	"errors"
	"fmt"
	"io"

	tea "charm.land/bubbletea/v2"
)

type secretModel struct {
	prompt  string
	value   []rune
	done    bool
	aborted bool
}

func newSecretModel(prompt string) secretModel { return secretModel{prompt: prompt} }

func (m secretModel) Init() tea.Cmd { return nil }

func (m secretModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		return m, nil
	case tea.KeyPressMsg:
		if msg.Mod.Contains(tea.ModCtrl) {
			if msg.Code == 'c' || msg.Code == 3 {
				m.aborted = true
				return m, tea.Quit
			}
			return m, nil
		}
		if msg.Mod.Contains(tea.ModAlt) || msg.Mod.Contains(tea.ModMeta) {
			return m, nil
		}
		switch msg.Code {
		case tea.KeyEnter:
			m.done = true
			return m, tea.Quit
		case tea.KeyEscape:
			m.aborted = true
			return m, tea.Quit
		case tea.KeyBackspace:
			if len(m.value) > 0 {
				m.value = m.value[:len(m.value)-1]
			}
			return m, nil
		}
		if msg.Text != "" {
			m.value = append(m.value, []rune(msg.Text)...)
		}
	}
	return m, nil
}

// View draws the prompt followed by the typed name.
func (m secretModel) View() tea.View { return tea.NewView(m.prompt + string(m.value)) }

// Value is the typed name.
func (m secretModel) Value() string { return string(m.value) }

// PromptSecret asks for a key name, echoing what is typed. An empty line stays
// empty (the caller reports `key name is required`), and Esc/Ctrl-C abort.
func PromptSecret(prompt string, in io.Reader, out io.Writer) (string, error) {
	final, err := tea.NewProgram(newSecretModel(prompt), tea.WithInput(in), tea.WithOutput(out)).Run()
	got, ok := final.(secretModel)
	if !ok {
		if err != nil {
			return "", err
		}
		return "", fmt.Errorf("ui: program returned an unexpected model")
	}
	if errors.Is(err, tea.ErrInterrupted) || got.aborted {
		return "", ErrAborted
	}
	if err != nil {
		return "", err
	}
	return got.Value(), nil
}

// ErrAborted reports a prompt the user cancelled.
var ErrAborted = errors.New("aborted")
