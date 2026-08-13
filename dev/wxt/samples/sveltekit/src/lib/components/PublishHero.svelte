<script lang="ts">
  const heroPanelClass =
    'relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/90 px-6 py-6 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_24px_80px_rgba(15,23,42,0.08)] ring-1 ring-white/60 backdrop-blur-xl sm:px-8 lg:px-10 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-24 before:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_48%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.14),transparent_42%)] after:pointer-events-none after:absolute after:right-4 after:top-4 after:h-16 after:w-16 after:rounded-full after:bg-sky-100/60 after:blur-2xl';
</script>

<section class={heroPanelClass}>
  <div class="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
    <div class="max-w-2xl">
      <p class="section-kicker text-[11px] font-semibold text-slate-500">/publish</p>
      <h1 class="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        Prepare your release window
      </h1>
      <p class="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
        This header uses a long utility string so Dev Selector can show why a component anchor from
        <code>PublishHero.svelte</code> is usually more useful than the raw class text.
      </p>
    </div>

    <div class="flex flex-col items-stretch gap-3 sm:items-end">
      <button
        type="button"
        class="publish-cta inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400/40">
        Publish changes
        <span aria-hidden="true">→</span>
      </button>
      <p class="text-xs text-slate-500">
        Good target: short stable class plus meaningful component anchor.
      </p>
    </div>
  </div>
</section>
