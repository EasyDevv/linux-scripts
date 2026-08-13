<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';

  type PromptSection = {
    id: string;
    badge: string;
    title: string;
    description: string;
    placeholder: string;
    applied: boolean;
    value: string;
  };

  let dialogOpen = $state(false);
  let previewCount = $state(0);
  let sections = $state<PromptSection[]>([
    {
      id: 'shared',
      badge: '공통',
      title: '공통 지침',
      description: '모든 채널에 공통으로 들어가는 톤과 CTA 규칙을 관리합니다.',
      placeholder: '브랜드 공통 지침을 입력하세요',
      applied: true,
      value: '첫 줄은 강하게 시작하고 마지막 줄은 CTA로 마무리하세요.',
    },
    {
      id: 'linkedin',
      badge: 'LinkedIn',
      title: '링크드인 포맷',
      description: '전문적인 톤과 짧은 요약 문단을 유지합니다.',
      placeholder: 'LinkedIn 전용 지침을 입력하세요',
      applied: true,
      value: '문단은 3개 이하로 유지하고 핵심 수치를 앞에 배치하세요.',
    },
    {
      id: 'threads',
      badge: 'Threads',
      title: 'Threads 포맷',
      description: '가벼운 문장과 후킹성 첫 문장을 테스트하는 영역입니다.',
      placeholder: 'Threads 전용 지침을 입력하세요',
      applied: true,
      value: '첫 문장은 질문형으로 시작하고 해시태그는 2개 이하로 제한하세요.',
    },
  ]);
</script>

<DialogPrimitive.Root bind:open={dialogOpen}>
  <section
    data-testid="publish-prompt-fixture"
    class="rounded-[28px] border border-slate-200/70 bg-white/85 p-6 shadow-sm"
  >
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div class="max-w-2xl">
        <p class="section-kicker text-[11px] font-semibold text-slate-500">Focus trap fixture</p>
        <h2 class="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
          Prompt dialog regression surface
        </h2>
        <p class="mt-2 text-sm leading-6 text-slate-600">
          실제 SNS Publisher처럼 dialog 안에 미리보기 버튼과 여러 textarea를 같이 두어
          Dev Selector의 selection mode와 host focus trap이 충돌하는 경로를 재현합니다.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <DialogPrimitive.Trigger
          data-testid="publish-prompt-open"
          class="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800"
        >
          프롬프트
        </DialogPrimitive.Trigger>

        <button
          type="button"
          class="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-400 shadow-xs"
          disabled
        >
          AI 생성
        </button>
      </div>
    </div>

    <div class="mt-5 grid gap-3 md:grid-cols-3">
      {#each sections as section (section.id)}
        <article class="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4">
          <div class="flex items-center gap-2">
            <span class="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white">
              {section.badge}
            </span>
            <p class="text-sm font-semibold text-slate-900">{section.title}</p>
          </div>
          <p class="mt-2 text-sm leading-6 text-slate-600">{section.description}</p>
        </article>
      {/each}
    </div>
  </section>

  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      data-testid="publish-prompt-overlay"
      class="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[2px]"
    />

    <DialogPrimitive.Content
      data-slot="dialog-content"
      data-testid="publish-prompt-dialog"
      class="fixed top-1/2 left-1/2 z-50 grid w-[min(980px,calc(100%-2rem))] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[28px] border border-slate-200/80 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
    >
      <div class="flex flex-col gap-3 border-b border-slate-200/80 pb-4 md:flex-row md:items-start md:justify-between">
        <div class="max-w-2xl">
          <p class="section-kicker text-[11px] font-semibold text-slate-500">/publish</p>
          <h3 class="mt-2 text-xl font-semibold text-slate-950">Prompt editor fixture</h3>
          <div
            data-slot="dialog-description"
            data-dialog-description
            class="mt-2 text-sm leading-6 text-slate-600"
          >
            focus trap이 미리보기 버튼으로 포커스를 되돌리려는 상황을 만들기 위해 첫 tabbable
            요소를 버튼으로 유지합니다.
          </div>
        </div>

        <button
          type="button"
          data-testid="publish-prompt-preview"
          class="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-xs transition hover:bg-slate-50"
          data-control="prompt-preview"
          onclick={() => {
            previewCount += 1;
          }}
        >
          미리보기
        </button>
      </div>

      <div class="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
        {#each sections as section (section.id)}
          <section
            data-testid={`publish-prompt-section-${section.id}`}
            class="space-y-4 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-5"
          >
            <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div class="space-y-1.5">
                <div class="flex items-center gap-2">
                  <span class="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white">
                    {section.badge}
                  </span>
                  <h4 class="text-sm font-semibold text-slate-950">{section.title}</h4>
                </div>
                <p class="text-sm leading-6 text-slate-600">{section.description}</p>
              </div>

              <label class="flex items-center gap-3 self-start rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-xs">
                <span>{section.applied ? '적용' : '미적용'}</span>
                <input
                  bind:checked={section.applied}
                  data-testid={`publish-prompt-toggle-${section.id}`}
                  type="checkbox"
                  class="h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-400/40"
                />
              </label>
            </div>

            <textarea
              bind:value={section.value}
              data-testid={`publish-prompt-editor-${section.id}`}
              rows={6}
              placeholder={section.placeholder}
              class="min-h-36 w-full resize-y rounded-2xl border border-slate-200/80 bg-white p-4 text-sm leading-6 text-slate-800 shadow-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
            ></textarea>
          </section>
        {/each}
      </div>

      <div class="flex flex-col gap-3 border-t border-slate-200/80 pt-4 md:flex-row md:items-center md:justify-between">
        <div class="text-xs leading-5 text-slate-500">
          <p>Regression note: dialog focus trap + extension shadow DOM input.</p>
          <p data-testid="publish-prompt-preview-count">Preview clicks: {previewCount}</p>
        </div>

        <div class="flex gap-2 self-end">
          <button
            type="button"
            data-testid="publish-prompt-cancel"
            class="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-xs transition hover:bg-slate-50"
            onclick={() => {
              dialogOpen = false;
            }}
          >
            취소
          </button>

          <button
            type="button"
            data-testid="publish-prompt-save"
            class="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            onclick={() => {
              dialogOpen = false;
            }}
          >
            저장
          </button>
        </div>
      </div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
