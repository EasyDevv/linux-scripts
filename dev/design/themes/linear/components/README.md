# linear/components

Copy these snippets into an app. Do not import this folder at runtime.

## settings-dialog.svelte

Dashboard **Providers** settings (`http://dashboard.localhost/`, source `apps/client/src/routes/+page.svelte`). Same chrome as `/sync` Settings: 480px Dialog, secondary wells, overlay Select, pill Cancel/Save.

Reuse:

1. App needs `Dialog`, `Field`, `Select`, `Input`, `Button`. If missing, copy those primitives from the dashboard `ui/` tree — do not rebuild the overlay.
2. Trigger: `outline` `icon-sm` `rounded-full` Settings icon, `aria-label="Settings"`.
3. Content: `w-[calc(100%-2rem)] max-w-[480px] gap-0 p-0 sm:max-w-[480px]`, `showCloseButton={false}`.
4. Select in a well: trigger `h-[30px]` / `--select-trigger-height`, `sideOffset={-(index * 32 + 30)}`, `avoidCollisions={false}`, `interactOutsideBehavior="ignore"` so the current value stays on the trigger.
5. Well rows: `@container overflow-hidden rounded-md bg-secondary`. Divider `mx-4` height `--hairline-width` fill `--foreground` at 0.1 (`data-role="row-divider"`), not `--border`.
6. Footer: `mx-0 mb-0 border-t-0 bg-transparent`. Cancel `secondary` pill, Save filled pill. Header/footer have no hairline (`design.json` `controls.dialog.noHeaderFooterRule`).

Replace labels, Select options, and `onSave` for the host product. Keep the geometry.
