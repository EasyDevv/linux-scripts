<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import RefreshCw from "@lucide/svelte/icons/refresh-cw";
	import { Button } from "$lib/components/ui/button/index.js";
	import InspectorCard from "./inspector-card.svelte";
	import PropPicker from "./prop-picker.svelte";

	type Group = { id: string; label: string; pool: string[] };

	const chromeIconClass = "text-muted-foreground hover:text-foreground";
	const sectionLabelStyle = "font-size: var(--text-heading-sm); font-weight: 500; color: var(--muted-foreground)";
	const pillOn = "rounded-full bg-accent px-2.5 text-label-sm font-medium text-foreground";

	let {
		title = "태그",
		groups = [
			{ id: "genre", label: "장르", pool: ["현대판타지", "판타지", "무협"] },
			{ id: "keyword", label: "키워드", pool: ["헌터", "성장", "배틀", "학원"] },
		] as Group[],
		selected = $bindable(["현대판타지", "헌터", "성장", "배틀"]),
		defaults = ["현대판타지", "헌터", "성장", "배틀"],
		open = $bindable(true),
	}: {
		title?: string;
		groups?: Group[];
		selected?: string[];
		defaults?: string[];
		open?: boolean;
	} = $props();

	function selectedIn(pool: string[]) {
		return pool.filter((tag) => selected.includes(tag));
	}

	function availableIn(pool: string[]) {
		return pool.filter((tag) => !selected.includes(tag)).map((tag) => ({ value: tag }));
	}

	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
	}

	function reset() {
		selected = [...defaults];
	}
</script>

<InspectorCard {title} {open} onToggle={() => (open = !open)}>
	{#snippet trailing()}
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			class={chromeIconClass}
			aria-label={`${title} 기본 선택`}
			onclick={reset}
		>
			<RefreshCw class="size-3.5" strokeWidth={1.75} />
		</Button>
	{/snippet}
	<div class="flex min-w-0 flex-col">
		{#each groups as group (group.id)}
			<div class="mt-2 flex min-w-0 flex-col first:mt-0">
				<div class="flex min-w-0 items-center" style="min-height: 28px; gap: 8px">
					<p
						class="m-0 min-w-0 flex-1 truncate text-heading-sm font-medium text-muted-foreground"
						style={sectionLabelStyle}
					>
						{group.label}
					</p>
					<PropPicker
						label={group.label}
						items={availableIn(group.pool)}
						search={`${group.label} 추가…`}
						align="end"
						ariaLabel={`${group.label} 추가`}
						onPick={toggle}
					>
						{#snippet trigger({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-sm"
								class={chromeIconClass}
								aria-label={`${group.label} 추가`}
							>
								<Plus class="size-3.5" strokeWidth={1.75} />
							</Button>
						{/snippet}
					</PropPicker>
				</div>
				<div class="mb-1 flex min-w-0 flex-wrap gap-1">
					{#each selectedIn(group.pool) as tag (tag)}
						<Button
							variant="ghost"
							size="sm"
							class={pillOn}
							aria-pressed={true}
							onclick={() => toggle(tag)}
						>
							{tag}
						</Button>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</InspectorCard>
