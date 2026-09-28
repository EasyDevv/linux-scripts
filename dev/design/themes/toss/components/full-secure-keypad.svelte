<!-- TDS FullSecureKeypad (components/Keypad/full-secure-keypad). Always dark (secure input chrome).
     frame    --keypad-secure fill; key area padding 6px 0 10px, 4 grid rows of 50h, padding 0 10
     key      20/30 white glyph + optional 13/19.5 --keypad-secure-hint Hangul hint (2px above)
     security each row keeps one empty cell at a random column (reorderEmptyCells reshuffles)
     bottom   56h row: shift 43 · 특수 43 · space 107 (inset 1px rgba(0,0,33,.16) seams) · submit 107 blue500
              ("입력 완료", disabled = opacity .3) -->
<script lang="ts">
	let {
		onKeyClick,
		onBackspaceClick,
		onSpaceClick,
		onSubmit,
		submitButtonText = "입력 완료",
		submitDisabled = false,
	}: {
		onKeyClick?: (value: string) => void;
		onBackspaceClick?: () => void;
		onSpaceClick?: () => void;
		onSubmit?: () => void;
		submitButtonText?: string;
		submitDisabled?: boolean;
	} = $props();

	const ROWS: [string, string][][] = [
		"1234567890".split("").map((k) => [k, ""]),
		[["q", "ㅂ"], ["w", "ㅈ"], ["e", "ㄷ"], ["r", "ㄱ"], ["t", "ㅅ"], ["y", "ㅛ"], ["u", "ㅕ"], ["i", "ㅑ"], ["o", "ㅐ"], ["p", "ㅔ"]],
		[["a", "ㅁ"], ["s", "ㄴ"], ["d", "ㅇ"], ["f", "ㄹ"], ["g", "ㅎ"], ["h", "ㅗ"], ["j", "ㅓ"], ["k", "ㅏ"], ["l", "ㅣ"]],
		[["z", "ㅋ"], ["x", "ㅌ"], ["c", "ㅊ"], ["v", "ㅍ"], ["b", "ㅠ"], ["n", "ㅜ"], ["m", "ㅡ"]],
	];

	let shift = $state(false);
	let empties = $state(ROWS.map((r) => Math.floor(Math.random() * (r.length + 1))));
	export function reorderEmptyCells() {
		empties = ROWS.map((r) => Math.floor(Math.random() * (r.length + 1)));
	}
	const cells = (row: [string, string][], at: number) => [...row.slice(0, at), null, ...row.slice(at)];
</script>

<div class="tds-secure-keypad" data-tds-mobile-component="FullSecureKeypad">
	<div class="keys">
		{#each ROWS as row, r (r)}
			<ul style:--cols={row.length + 1 + (r === 3 ? 1 : 0)}>
				{#each cells(row, empties[r]) as cell, c (c)}
					<li>
						{#if cell}
							<button type="button" onclick={() => onKeyClick?.(shift ? cell[0].toUpperCase() : cell[0])}>
								<span class="glyph">{shift ? cell[0].toUpperCase() : cell[0]}</span>
								{#if cell[1]}<span class="hint" aria-hidden="true">{cell[1]}</span>{/if}
							</button>
						{/if}
					</li>
				{/each}
				{#if r === 3}
					<li>
						<button type="button" aria-label="지우기" onclick={onBackspaceClick}>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6" /></svg>
						</button>
					</li>
				{/if}
			</ul>
		{/each}
	</div>
	<ul class="bottom">
		<li><button type="button" class="fn" aria-pressed={shift} aria-label="shift" onclick={() => (shift = !shift)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 4 12h4.5v7h7v-7H20Z" /></svg></button></li>
		<li><button type="button" class="fn" aria-label="특수로 전환">특수</button></li>
		<li><button type="button" class="fn" aria-label="space" onclick={onSpaceClick}>Space</button></li>
		<li><button type="button" class="submit" disabled={submitDisabled} onclick={onSubmit}>{submitButtonText}</button></li>
	</ul>
</div>

<style>
	.tds-secure-keypad {
		background: var(--keypad-secure);
		color: var(--static-white);
	}
	.keys {
		padding: 6px 0 10px;
	}
	ul {
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		margin: 0;
		padding: 0 10px;
		list-style: none;
	}
	.keys ul {
		height: 50px;
	}
	button {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.glyph {
		font-size: var(--text-t4);
		line-height: 25px;
	}
	.hint {
		margin-top: 2px;
		color: var(--keypad-secure-hint);
		font-size: var(--text-t7);
		line-height: 16px;
	}
	svg {
		width: 24px;
		height: 24px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.bottom {
		grid-template-columns: 43fr 43fr 107fr 107fr;
		height: 56px;
		padding: 0;
	}
	.fn {
		box-shadow: inset 0 0 0 1px var(--keypad-secure-seam);
		font-size: var(--text-t5);
	}
	.fn[aria-pressed="true"] {
		background: var(--keypad-secure-pressed);
	}
	.submit {
		background: var(--blue-500);
		font-size: var(--text-t5);
	}
	.submit:disabled {
		opacity: var(--control-disabled-opacity);
	}
</style>
