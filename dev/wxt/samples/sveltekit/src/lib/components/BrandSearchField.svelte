<script lang="ts">
  export let placeholder = 'Search brand name, owner, or tag';

  const searchInputClass =
    'brand-search-input w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 text-sm text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.06)] outline-none placeholder:text-slate-400 transition focus:border-sky-400 focus:bg-white focus:shadow-[0_0_0_1px_rgba(14,165,233,0.2),0_18px_40px_rgba(14,165,233,0.12)] sm:text-[15px] [background-image:linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))]';
</script>

<label class="block">
  <span class="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
    Brand search
  </span>
  <input type="search" placeholder={placeholder} class={searchInputClass} />
</label>
