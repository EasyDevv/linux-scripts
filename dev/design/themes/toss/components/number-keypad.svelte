<!-- TDS NumberKeypad / AlphabetKeypad (components/Keypad). Measured:
     frame    padding 0 10, table max-width 340, rows 66h, cells padding 1, role=button + aria-label
     key      30px / 64px line height, grey700, no fill; pressed = greyOpacity100 r12 well
     number   3 x 4: 1-9, [empty], 0, backspace (20px icon, "지우기"); numbers prop reorders (secure shuffles)
     alphabet 7 columns of A-Z, the last row ends in backspace -->
<script lang="ts">
	let {
		variant = "number",
		numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0],
		onKeyClick,
		onBackspaceClick,
	}: {
		variant?: "number" | "alphabet";
		numbers?: number[];
		onKeyClick?: (value: string) => void;
		onBackspaceClick?: () => void;
	} = $props();

	type Key = string | null | "⌫";
	const rows = $derived.by<Key[][]>(() => {
		if (variant === "number") {
			const n = numbers.map(String);
			return [n.slice(0, 3), n.slice(3, 6), n.slice(6, 9), [null, n[9], "⌫"]];
		}
		const a: Key[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
		const out: Key[][] = [];
		for (let i = 0; i < a.length; i += 7) out.push(a.slice(i, i + 7));
		const last = out[out.length - 1];
		while (last.length < 6) last.push(null);
		last.push("⌫");
		return out;
	});
</script>

<div class="tds-keypad" data-tds-mobile-component={variant === "number" ? "NumberKeypad" : "AlphabetKeypad"}>
	<table>
		<tbody>
			{#each rows as row, r (r)}
				<tr>
					{#each row as key, c (c)}
						{#if key === null}
							<td aria-hidden="true" tabindex="-1"></td>
						{:else if key === "⌫"}
							<td role="button" tabindex="0" aria-label="지우기" onclick={onBackspaceClick} onkeydown={(e) => e.key === "Enter" && onBackspaceClick?.()}>
								<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 3h8.3c.8 0 1.5.7 1.5 1.5v7c0 .8-.7 1.5-1.5 1.5H5.2L1 8l4.2-5Zm2.6 3 4 4m0-4-4 4" /></svg>
							</td>
						{:else}
							<td role="button" tabindex="0" aria-label={key} onclick={() => onKeyClick?.(key)} onkeydown={(e) => e.key === "Enter" && onKeyClick?.(key)}>{key}</td>
						{/if}
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.tds-keypad {
		padding: 0 10px;
		font-size: var(--text-t1);
	}
	table {
		width: 100%;
		max-width: 340px;
		margin: 0 auto;
		border-collapse: collapse;
		table-layout: fixed;
	}
	td {
		height: 66px;
		padding: 1px;
		color: var(--ink-soft);
		font-size: var(--text-t1);
		line-height: 64px;
		text-align: center;
		cursor: pointer;
		border-radius: 12px;
		user-select: none;
		-webkit-tap-highlight-color: transparent;
	}
	td[aria-hidden="true"] {
		cursor: default;
	}
	td[role="button"]:active {
		background: var(--grey-opacity-100);
	}
	svg {
		width: 20px;
		height: 20px;
		vertical-align: middle;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
