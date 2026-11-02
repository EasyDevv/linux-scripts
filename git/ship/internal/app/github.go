// github.go ports the GitHub section of ship.ts: gh login, repo lookup,
// origin wiring, repository creation, and the picker-backed visibility prompt.
package app

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	"ship/internal/ui"
)

// githubOrigin matches the URLs connectOrigin accepts.
var githubOrigin = regexp.MustCompile(`^(https?://github\.com/|git@github\.com:)`)

// canPick is canPick(): the inline picker needs stdin and stderr.
func canPick() bool { return stdinIsTerminal() && stderrIsTerminal() }

// ghLogin is ghLogin(): user login from the authenticated gh CLI.
func (c *ctx) ghLogin() (string, error) {
	if !onPath("gh") {
		return "", fatal("GitHub CLI (gh) is not installed: https://cli.github.com/")
	}
	res, err := c.exec(c.cwd, false, "gh", "api", "user", "--jq", ".login")
	if err != nil || res.Code != 0 {
		return "", fatal("gh is not signed in (run: gh auth login)")
	}
	return strings.TrimSpace(res.Stdout), nil
}

// repoURL is repoUrl(full): the repository's URL, or "" when it does not exist.
func (c *ctx) repoURL(full string) string {
	res, err := c.exec(c.cwd, false, "gh", "repo", "view", full, "--json", "url", "--jq", ".url")
	if err != nil || res.Code != 0 {
		return ""
	}
	return strings.TrimSpace(res.Stdout)
}

// connectOrigin points origin at url, refusing anything that is not GitHub.
func (c *ctx) connectOrigin(url string) error {
	if !githubOrigin.MatchString(url) {
		return fatal("refusing to set origin to a non-GitHub URL")
	}
	res, _ := c.git(true, "remote", "get-url", "origin")
	if res.Code == 0 {
		c.printf("%sUpdating origin to %s%s\n", Yellow(), url, NC())
		_, err := c.git(false, "remote", "set-url", "origin", url)
		return err
	}
	c.printf("%sAdding origin %s%s\n", Yellow(), url, NC())
	_, err := c.git(false, "remote", "add", "origin", url)
	return err
}

// setupGithub points origin at <login>/<name>, creating the repository when it
// does not exist yet. Prompts on a TTY for whatever the flags left open.
// It does not push.
func (c *ctx) setupGithub(name, visibility string) (string, error) {
	login, err := c.ghLogin()
	if err != nil {
		return "", err
	}
	repoName := name
	if repoName == "" {
		repoName = filepath.Base(c.root)
	}
	if name == "" && c.interactive {
		answer, err := c.ask(fmt.Sprintf("%sRepository name [%s]: %s", Yellow(), repoName, NC()))
		if err != nil {
			return "", fatal(err.Error())
		}
		if answer != "" {
			repoName = answer
		}
	}
	full := login + "/" + repoName

	c.printf("%sChecking %s...%s\n", Cyan(), full, NC())
	if existing := c.repoURL(full); existing != "" {
		c.printf("%s%s already exists; connecting.%s\n", Green(), full, NC())
		if err := c.connectOrigin(existing); err != nil {
			return "", err
		}
		return existing, nil
	}

	chosen := visibility
	if chosen == "" && canPick() {
		options := []string{"private", "public"}
		index, aborted, err := ui.Pick(
			fmt.Sprintf("Visibility of %s", full),
			[]ui.Item{{Label: "private", Hint: "(default)"}, {Label: "public"}},
			0, c.color, c.stdin, c.stderr,
		)
		if err != nil {
			return "", fatal(err.Error())
		}
		if aborted {
			return "", fatalCode(130, "aborted; no repository was created")
		}
		chosen = options[index]
	}
	if chosen == "" {
		chosen = "private"
	}

	c.printf("%sCreating %s (%s)...%s\n", Cyan(), full, chosen, NC())
	res, err := c.exec(c.cwd, true, "gh", "repo", "create", full, "--"+chosen)
	if err != nil || res.Code != 0 {
		return "", fatal("failed to create the repository")
	}
	url := c.repoURL(full)
	if url == "" {
		return "", fatal(fmt.Sprintf("created %s, but could not read its URL", full))
	}
	if err := c.connectOrigin(url); err != nil {
		return "", err
	}
	return url, nil
}

// setupAndPush is setupAndPush(): connect or create, push, report the URL.
func (c *ctx) setupAndPush() error {
	url, err := c.setupGithub(c.nameArg, c.visibility)
	if err != nil {
		return err
	}
	if !c.pushUpstream("origin") {
		return fatal(fmt.Sprintf("origin is %s, but pushing failed", url))
	}
	c.printf("%sPushed.%s %s%s%s\n", Green(), NC(), Blue(), url, NC())
	return nil
}
