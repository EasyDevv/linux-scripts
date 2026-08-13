<script lang="ts">
  import BrandCard from '$lib/components/BrandCard.svelte';
  import BrandSearchField from '$lib/components/BrandSearchField.svelte';

  const brands = [
    {
      name: 'Acorn Labs',
      owner: 'Jamie Rivera',
      tone: 'Clear, helpful, optimistic',
      status: 'Ready',
      summary: 'A compact card wrapper with a stable class and nested utility-heavy content.',
    },
    {
      name: 'Northwind Home',
      owner: 'Priya Shah',
      tone: 'Warm, editorial, premium',
      status: 'Needs review',
      summary: 'A good fallback target when a selector needs class preview or count details.',
    },
  ];
</script>

<div class="grid gap-6">
  <section class="rounded-[28px] border border-slate-200/70 bg-white/80 p-6 shadow-sm">
    <div class="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <p class="section-kicker text-[11px] font-semibold text-slate-500">/brands</p>
        <h1 class="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
          Review brand entries
        </h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Use the input and card wrappers here when checking how Dev Selector summarizes classes
          for generic UI targets.
        </p>
      </div>

      <div class="w-full max-w-md">
        <BrandSearchField />
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      {#each brands as brand}
        <BrandCard {...brand} />
      {/each}
    </div>
  </section>
</div>
