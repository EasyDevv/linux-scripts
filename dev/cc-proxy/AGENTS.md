# cc-proxy

Local Anthropic proxy for Claude Code: model aliases (haiku/sonnet/opus/fable) go to other providers'
Anthropic-compatible endpoints with fallbacks, ending at Claude. Guide and measured facts:
`~/chat/docs/agent/261111-claude-code-proxy-opencode-go-xai.md`.

- Pure logic lives in `config.ts`, `normalize.ts`, `stats.ts` (`bun test`); `server.ts` is I/O.
- One request transform for every non-Anthropic provider (strictest wins); provider differences are only
  URL, auth and extra headers in `upstreams.ts`. Do not branch routing on a provider name.
- Credentials come from pi's `~/.pi/agent/auth.json`; OAuth refresh takes pi's `auth.json.lock`.
- Consumers: Claude Code plugin `~/.agents/plugins/proxy`, dashboard `apps/server/src/cc_proxy.rs` +
  `apps/client/src/lib/settings/cc-proxy-section.svelte`. Keep `/_proxy/*` shapes in step with them.
- After a change: `bun test`, `bunx tsc -p .`, `systemctl --user restart cc-proxy`, then
  `claude -p "say: pong" --model haiku </dev/null` and `cc-proxy status`.
