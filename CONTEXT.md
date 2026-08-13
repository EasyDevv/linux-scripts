# Domain Language

Terms used in the executor project (`~/.local/share/scripts/dev/executor/`).

## Core Concepts

**Executor**
The overall system. A Bun/TypeScript CLI and systemd user service that manages long-running dev processes (instances).

**Instance**
A single managed process defined in the config file. Each instance has a name, directory (`dir`), command (`cmd`), environment variables (`env`), and an enabled/disabled state. Examples: `sns-publisher`, `dev-core`, `svelte-term`.

**Config**
The on-disk JSON file (`~/.config/systemd/user/executor.json`) that defines instances. Read and written through the `Config` module (`config.ts`). Callers interact with `NormalizedConfig` (instances map + disabled set + restart tokens). The raw `JsonObject` shape is hidden inside the Config module.

**Supervisor**
The daemon that runs in the foreground via `executor run`. Polls the config every 2 seconds and reconciles desired vs actual managed processes. Decides *which* instances should run; delegates *how* to the Process Manager.

## Modules (after architecture refactoring)

**Config module** (`config.ts`)
- Interface: `readConfig()` / `writeConfig(mutator)`
- Hides `JsonObject` and `RawInstance` types
- Returns `NormalizedConfig` with methods: `getInstance`, `hasInstance`, `isEnabled`, `getPort`, `instanceMatchingCwd`
- `ConfigMutator`: `setEnabled(name, bool)` / `setRestartToken(name, token)`

**Process Manager** (`process-manager.ts`)
- Interface: `ProcessManager` class with `start(instance)`, `isActive(name, cmd)`, `listeningAddresses(name, cmd)`, `killProcessOnPort(port)`, `loggedPort(name)`, etc.
- Absorbed `runtime.ts` (PID files, ps, lsof, fuser)
- Supervisor's `terminateProcessTree` and `startManagedInstance` -> `ProcessManager.start()`
- Returns `ManagedProcess` handles with `.stop()` and `.running`

**Readiness module** (`readiness.ts`)
- Interface: `changeAndWait(...)` / `stopAndVerify(name)`
- Owns all startup timing, polling loops, port conflict detection, timeout logic
- Replaced `applyInstanceChange` and `applyInstanceStop` from old `journal.ts`

**Vite Adapter** (`vite-adapter.ts`)
- `isViteCommand(cmd)`, `viteReadyPattern()`, `printViteReadyFallback(...)` 
- Keeps Vite-specific knowledge out of the core Readiness module

**Journal module** (`journal.ts`)
- Log display: `showExecutorServiceLogs`, `showInstanceLogs`, `showRecentLogs`
- Service control: `reloadExecutorService`, `verifyExecutorServiceActive`
- No longer contains readiness polling logic

## Dependency Graph

```
main.ts → commands.ts → config.ts (readConfig/writeConfig)
                       → readiness.ts (changeAndWait/stopAndVerify)
                       → journal.ts (showRecentLogs, service control)
                       → process-manager.ts (ProcessManager)
                       → supervisor.ts (runSupervisor)
                       → vite-adapter.ts (isViteCommand)

supervisor.ts → config.ts (readConfig)
             → process-manager.ts (ProcessManager)

readiness.ts → journal.ts (service control, log display)
            → process-manager.ts (listeningAddresses, killProcessOnPort)
            → vite-adapter.ts (printViteReadyFallback)
            → utils.ts (runText, sleepMs, formatSince, fail)
```
