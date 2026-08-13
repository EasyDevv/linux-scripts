<script lang="ts">
  export let name: string;
  export let owner: string;
  export let tone: string;
  export let status: string;
  export let summary: string;

  const cardShellClass =
    'brand-card group relative overflow-hidden rounded-[26px] border border-slate-200/70 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_18px_54px_rgba(148,163,184,0.18)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_1px_2px_rgba(15,23,42,0.08),0_24px_80px_rgba(15,23,42,0.16)]';

  const metaStripClass =
    'grid gap-4 rounded-[22px] border border-dashed border-slate-200/80 bg-[linear-gradient(135deg,rgba(248,250,252,0.96),rgba(255,255,255,0.82))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] sm:grid-cols-[minmax(0,1fr)_auto]';
</script>

<article class={cardShellClass}>
  <div class={metaStripClass}>
    <div>
      <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Brand</p>
      <h3 class="mt-2 text-lg font-semibold text-slate-950">{name}</h3>
    </div>
    <span
      class="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
      {status}
    </span>
  </div>

  <p class="mt-4 text-sm leading-6 text-slate-600">{summary}</p>

  <dl class="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
    <div class="rounded-2xl bg-slate-50 px-4 py-3">
      <dt class="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Owner</dt>
      <dd class="mt-2 font-medium text-slate-900">{owner}</dd>
    </div>
    <div class="rounded-2xl bg-slate-50 px-4 py-3">
      <dt class="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Tone</dt>
      <dd class="mt-2 font-medium text-slate-900">{tone}</dd>
    </div>
  </dl>
</article>
