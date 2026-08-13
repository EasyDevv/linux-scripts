<script lang="ts">
  import { page } from '$app/stores';
  import '../app.css';

  const navItems = [
    { href: '/', label: 'Overview' },
    { href: '/publish', label: 'Publish' },
    { href: '/brands', label: 'Brands' },
  ];
</script>

<svelte:head>
  <title>Dev Selector SvelteKit Fixture</title>
</svelte:head>

<div class="page-shell">
  <div class="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-8 lg:px-10">
    <header class="rounded-full border border-white/70 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="section-kicker text-[11px] font-semibold text-slate-500">
            Dev Selector fixtures
          </p>
          <h1 class="text-lg font-semibold text-slate-900">SvelteKit sample workspace</h1>
        </div>

        <nav class="flex flex-wrap gap-2">
          {#each navItems as item}
            <a
              href={item.href}
              class={`nav-link rounded-full px-3 py-2 text-sm font-medium transition ${
                $page.url.pathname === item.href
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white/70 text-slate-600 hover:bg-white hover:text-slate-900'
              }`}>
              {item.label}
            </a>
          {/each}
        </nav>
      </div>
    </header>

    <main class="flex-1">
      <slot />
    </main>
  </div>
</div>
