<script lang="ts">
  const fixtureRoutes = [
    {
      href: '/publish',
      label: 'Publish route',
      description:
        'Includes the CTA-heavy hero plus a bits-ui prompt dialog fixture for modal focus-trap regressions.',
    },
    {
      href: '/brands',
      label: 'Brands route',
      description:
        'Includes a card wrapper and an input field with utility-heavy class strings.',
    },
  ];
</script>

<section class="grid gap-4 md:grid-cols-2">
  {#each fixtureRoutes as route}
    <a
      href={route.href}
      class="rounded-[28px] border border-slate-200/70 bg-white/80 p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <p class="section-kicker text-[11px] font-semibold text-slate-500">{route.href}</p>
      <h2 class="mt-3 text-xl font-semibold text-slate-950">{route.label}</h2>
      <p class="mt-2 text-sm leading-6 text-slate-600">{route.description}</p>
    </a>
  {/each}
</section>
