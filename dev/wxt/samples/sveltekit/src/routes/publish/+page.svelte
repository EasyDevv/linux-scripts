<script lang="ts">
  import PublishHero from '$lib/components/PublishHero.svelte';
  import PublishPromptFixture from '$lib/components/PublishPromptFixture.svelte';

  const checkpoints = [
    { title: 'Audience', detail: 'Double-check launch segments and rollout notes.' },
    { title: 'Content', detail: 'Verify hero copy, CTA text, and summary cards.' },
    { title: 'Telemetry', detail: 'Confirm conversion events are wired before pushing live.' },
  ];
</script>

<div class="grid gap-6">
  <PublishHero />
  <PublishPromptFixture />

  <section class="grid gap-4 rounded-[28px] border border-slate-200/70 bg-white/80 p-6 shadow-sm md:grid-cols-3">
    {#each checkpoints as checkpoint}
      <article class="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4">
        <p class="section-kicker text-[11px] font-semibold text-slate-500">Release check</p>
        <h2 class="mt-2 text-base font-semibold text-slate-950">{checkpoint.title}</h2>
        <p class="mt-2 text-sm leading-6 text-slate-600">{checkpoint.detail}</p>
      </article>
    {/each}
  </section>
</div>
