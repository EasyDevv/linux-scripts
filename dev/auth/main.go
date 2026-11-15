// Command auth is the central credential store for the dev tools: one file, one login CLI.
// cc-proxy, the decision daemon and the dashboard read the file; only this tool writes it.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"time"

	"auth/internal/auth"
	"auth/internal/cli"
	"auth/internal/oauth"
	"auth/internal/store"
)

func main() {
	path, err := store.DefaultPath(os.Getenv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "auth: %v\n", err)
		os.Exit(1)
	}
	home, _ := os.UserHomeDir()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	secret := cli.TTYSecret
	if fi, err := os.Stdin.Stat(); err == nil && fi.Mode()&os.ModeCharDevice == 0 {
		secret = nil // key piped on stdin
	}
	os.Exit(cli.Run(ctx, os.Args[1:], cli.Env{
		Service: auth.Service{
			Store: store.Store{Path: path},
			Flows: map[string]oauth.Flow{"xai": oauth.NewXAI()},
			Now:   time.Now,
		},
		Stdin:  os.Stdin,
		Stdout: os.Stdout,
		Stderr: os.Stderr,
		Home:   home,
		Secret: secret,
	}))
}
