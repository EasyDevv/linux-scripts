<!-- SEED Text (seed-design.io/react/components/text): a textStyle from the type scale
     (screenTitle, articleBody, articleNote, t1…t14 × Regular/Medium/Bold, t1…t14 Static…),
     optional colour token, maxLines (single / multi via --seed-max-lines) and decoration. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { variants } from "./seed.ts";

	let {
		as = "span",
		textStyle = "t5Regular",
		color,
		maxLines,
		decoration = "none",
		align,
		children,
	}: {
		as?: string;
		textStyle?: string;
		/** a theme token, e.g. "--fg-neutral-muted" */
		color?: string;
		maxLines?: number;
		decoration?: "none" | "underline" | "line";
		align?: "left" | "center" | "right";
		children?: Snippet;
	} = $props();

	const lines = $derived(maxLines === undefined ? "none" : maxLines === 1 ? "single" : "multi");
	const style = $derived(
		[color && `--seed-text-color: var(${color})`, maxLines && maxLines > 1 && `--seed-max-lines: ${maxLines}`, align && `--seed-text-align: ${align}`]
			.filter(Boolean)
			.join("; "),
	);
</script>

<svelte:element this={as} class="seed-text" {...variants({ textStyle, maxLines: lines, textDecorationLine: decoration })} style={style || undefined}>
	{@render children?.()}
</svelte:element>

<style>
	/* @recipe text */
	/* SEED recipe: text */
	:global(.seed-text) {
		margin: 0;
		color: var(--seed-text-color);
		font-size: var(--seed-font-size);
		font-weight: var(--seed-font-weight);
		line-height: var(--seed-line-height);
		text-align: var(--seed-text-align);
		user-select: var(--seed-user-select);
		--seed-text-color: inherit;
		--seed-font-size: inherit;
		--seed-font-weight: inherit;
		--seed-line-height: inherit;
		--seed-text-align: inherit;
		--seed-user-select: inherit;
		--seed-white-space: inherit;
		--seed-max-lines: initial;
	}
	:global(.seed-text[data-text-style="screenTitle"]) {
		--seed-font-size: var(--text-t10);
		--seed-line-height: var(--text-t10--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="articleBody"]) {
		--seed-font-size: var(--text-t5);
		--seed-line-height: var(--text-t6--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="articleNote"]) {
		--seed-font-size: var(--text-t4);
		--seed-line-height: var(--text-t5--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t1Regular"]) {
		--seed-font-size: var(--text-t1);
		--seed-line-height: var(--text-t1--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t1Medium"]) {
		--seed-font-size: var(--text-t1);
		--seed-line-height: var(--text-t1--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t1Bold"]) {
		--seed-font-size: var(--text-t1);
		--seed-line-height: var(--text-t1--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t2Regular"]) {
		--seed-font-size: var(--text-t2);
		--seed-line-height: var(--text-t2--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t2Medium"]) {
		--seed-font-size: var(--text-t2);
		--seed-line-height: var(--text-t2--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t2Bold"]) {
		--seed-font-size: var(--text-t2);
		--seed-line-height: var(--text-t2--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t3Regular"]) {
		--seed-font-size: var(--text-t3);
		--seed-line-height: var(--text-t3--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t3Medium"]) {
		--seed-font-size: var(--text-t3);
		--seed-line-height: var(--text-t3--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t3Bold"]) {
		--seed-font-size: var(--text-t3);
		--seed-line-height: var(--text-t3--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t4Regular"]) {
		--seed-font-size: var(--text-t4);
		--seed-line-height: var(--text-t4--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t4Medium"]) {
		--seed-font-size: var(--text-t4);
		--seed-line-height: var(--text-t4--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t4Bold"]) {
		--seed-font-size: var(--text-t4);
		--seed-line-height: var(--text-t4--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t5Regular"]) {
		--seed-font-size: var(--text-t5);
		--seed-line-height: var(--text-t5--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t5Medium"]) {
		--seed-font-size: var(--text-t5);
		--seed-line-height: var(--text-t5--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t5Bold"]) {
		--seed-font-size: var(--text-t5);
		--seed-line-height: var(--text-t5--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t6Regular"]) {
		--seed-font-size: var(--text-t6);
		--seed-line-height: var(--text-t6--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t6Medium"]) {
		--seed-font-size: var(--text-t6);
		--seed-line-height: var(--text-t6--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t6Bold"]) {
		--seed-font-size: var(--text-t6);
		--seed-line-height: var(--text-t6--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t7Regular"]) {
		--seed-font-size: var(--text-t7);
		--seed-line-height: var(--text-t7--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t7Medium"]) {
		--seed-font-size: var(--text-t7);
		--seed-line-height: var(--text-t7--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t7Bold"]) {
		--seed-font-size: var(--text-t7);
		--seed-line-height: var(--text-t7--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t8Regular"]) {
		--seed-font-size: var(--text-t8);
		--seed-line-height: var(--text-t8--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t8Medium"]) {
		--seed-font-size: var(--text-t8);
		--seed-line-height: var(--text-t8--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t8Bold"]) {
		--seed-font-size: var(--text-t8);
		--seed-line-height: var(--text-t8--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t9Regular"]) {
		--seed-font-size: var(--text-t9);
		--seed-line-height: var(--text-t9--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t9Medium"]) {
		--seed-font-size: var(--text-t9);
		--seed-line-height: var(--text-t9--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t9Bold"]) {
		--seed-font-size: var(--text-t9);
		--seed-line-height: var(--text-t9--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t10Regular"]) {
		--seed-font-size: var(--text-t10);
		--seed-line-height: var(--text-t10--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t10Medium"]) {
		--seed-font-size: var(--text-t10);
		--seed-line-height: var(--text-t10--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t10Bold"]) {
		--seed-font-size: var(--text-t10);
		--seed-line-height: var(--text-t10--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t11Regular"]) {
		--seed-font-size: var(--text-t11);
		--seed-line-height: var(--text-t11--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t11Medium"]) {
		--seed-font-size: var(--text-t11);
		--seed-line-height: var(--text-t11--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t11Bold"]) {
		--seed-font-size: var(--text-t11);
		--seed-line-height: var(--text-t11--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t12Regular"]) {
		--seed-font-size: var(--text-t12);
		--seed-line-height: var(--text-t12--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t12Medium"]) {
		--seed-font-size: var(--text-t12);
		--seed-line-height: var(--text-t12--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t12Bold"]) {
		--seed-font-size: var(--text-t12);
		--seed-line-height: var(--text-t12--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t13Regular"]) {
		--seed-font-size: var(--text-t13);
		--seed-line-height: var(--text-t13--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t13Medium"]) {
		--seed-font-size: var(--text-t13);
		--seed-line-height: var(--text-t13--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t13Bold"]) {
		--seed-font-size: var(--text-t13);
		--seed-line-height: var(--text-t13--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t14Regular"]) {
		--seed-font-size: var(--text-t14);
		--seed-line-height: var(--text-t14--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t14Medium"]) {
		--seed-font-size: var(--text-t14);
		--seed-line-height: var(--text-t14--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t14Bold"]) {
		--seed-font-size: var(--text-t14);
		--seed-line-height: var(--text-t14--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t1StaticRegular"]) {
		--seed-font-size: var(--text-t1-static);
		--seed-line-height: var(--text-t1-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t1StaticMedium"]) {
		--seed-font-size: var(--text-t1-static);
		--seed-line-height: var(--text-t1-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t1StaticBold"]) {
		--seed-font-size: var(--text-t1-static);
		--seed-line-height: var(--text-t1-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t2StaticRegular"]) {
		--seed-font-size: var(--text-t2-static);
		--seed-line-height: var(--text-t2-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t2StaticMedium"]) {
		--seed-font-size: var(--text-t2-static);
		--seed-line-height: var(--text-t2-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t2StaticBold"]) {
		--seed-font-size: var(--text-t2-static);
		--seed-line-height: var(--text-t2-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t3StaticRegular"]) {
		--seed-font-size: var(--text-t3-static);
		--seed-line-height: var(--text-t3-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t3StaticMedium"]) {
		--seed-font-size: var(--text-t3-static);
		--seed-line-height: var(--text-t3-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t3StaticBold"]) {
		--seed-font-size: var(--text-t3-static);
		--seed-line-height: var(--text-t3-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t4StaticRegular"]) {
		--seed-font-size: var(--text-t4-static);
		--seed-line-height: var(--text-t4-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t4StaticMedium"]) {
		--seed-font-size: var(--text-t4-static);
		--seed-line-height: var(--text-t4-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t4StaticBold"]) {
		--seed-font-size: var(--text-t4-static);
		--seed-line-height: var(--text-t4-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t5StaticRegular"]) {
		--seed-font-size: var(--text-t5-static);
		--seed-line-height: var(--text-t5-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t5StaticMedium"]) {
		--seed-font-size: var(--text-t5-static);
		--seed-line-height: var(--text-t5-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t5StaticBold"]) {
		--seed-font-size: var(--text-t5-static);
		--seed-line-height: var(--text-t5-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t6StaticRegular"]) {
		--seed-font-size: var(--text-t6-static);
		--seed-line-height: var(--text-t6-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t6StaticMedium"]) {
		--seed-font-size: var(--text-t6-static);
		--seed-line-height: var(--text-t6-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t6StaticBold"]) {
		--seed-font-size: var(--text-t6-static);
		--seed-line-height: var(--text-t6-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t7StaticRegular"]) {
		--seed-font-size: var(--text-t7-static);
		--seed-line-height: var(--text-t7-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t7StaticMedium"]) {
		--seed-font-size: var(--text-t7-static);
		--seed-line-height: var(--text-t7-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t7StaticBold"]) {
		--seed-font-size: var(--text-t7-static);
		--seed-line-height: var(--text-t7-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t8StaticRegular"]) {
		--seed-font-size: var(--text-t8-static);
		--seed-line-height: var(--text-t8-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t8StaticMedium"]) {
		--seed-font-size: var(--text-t8-static);
		--seed-line-height: var(--text-t8-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t8StaticBold"]) {
		--seed-font-size: var(--text-t8-static);
		--seed-line-height: var(--text-t8-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t9StaticRegular"]) {
		--seed-font-size: var(--text-t9-static);
		--seed-line-height: var(--text-t9-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t9StaticMedium"]) {
		--seed-font-size: var(--text-t9-static);
		--seed-line-height: var(--text-t9-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t9StaticBold"]) {
		--seed-font-size: var(--text-t9-static);
		--seed-line-height: var(--text-t9-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t10StaticRegular"]) {
		--seed-font-size: var(--text-t10-static);
		--seed-line-height: var(--text-t10-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t10StaticMedium"]) {
		--seed-font-size: var(--text-t10-static);
		--seed-line-height: var(--text-t10-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t10StaticBold"]) {
		--seed-font-size: var(--text-t10-static);
		--seed-line-height: var(--text-t10-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t11StaticRegular"]) {
		--seed-font-size: var(--text-t11-static);
		--seed-line-height: var(--text-t11-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t11StaticMedium"]) {
		--seed-font-size: var(--text-t11-static);
		--seed-line-height: var(--text-t11-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t11StaticBold"]) {
		--seed-font-size: var(--text-t11-static);
		--seed-line-height: var(--text-t11-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t12StaticRegular"]) {
		--seed-font-size: var(--text-t12-static);
		--seed-line-height: var(--text-t12-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t12StaticMedium"]) {
		--seed-font-size: var(--text-t12-static);
		--seed-line-height: var(--text-t12-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t12StaticBold"]) {
		--seed-font-size: var(--text-t12-static);
		--seed-line-height: var(--text-t12-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t13StaticRegular"]) {
		--seed-font-size: var(--text-t13-static);
		--seed-line-height: var(--text-t13-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t13StaticMedium"]) {
		--seed-font-size: var(--text-t13-static);
		--seed-line-height: var(--text-t13-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t13StaticBold"]) {
		--seed-font-size: var(--text-t13-static);
		--seed-line-height: var(--text-t13-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-text-style="t14StaticRegular"]) {
		--seed-font-size: var(--text-t14-static);
		--seed-line-height: var(--text-t14-static--line-height);
		--seed-font-weight: var(--font-weight-regular);
	}
	:global(.seed-text[data-text-style="t14StaticMedium"]) {
		--seed-font-size: var(--text-t14-static);
		--seed-line-height: var(--text-t14-static--line-height);
		--seed-font-weight: var(--font-weight-medium);
	}
	:global(.seed-text[data-text-style="t14StaticBold"]) {
		--seed-font-size: var(--text-t14-static);
		--seed-line-height: var(--text-t14-static--line-height);
		--seed-font-weight: var(--font-weight-bold);
	}
	:global(.seed-text[data-max-lines="none"]) {
		overflow: unset;
		min-width: unset;
		text-overflow: unset;
		white-space: var(--seed-white-space);
		-webkit-line-clamp: unset;
	}
	:global(.seed-text[data-max-lines="single"]) {
		display: block;
		overflow: hidden;
		min-width: 0;
		text-overflow: ellipsis;
		white-space: nowrap;
		-webkit-line-clamp: var(--seed-max-lines);
	}
	:global(.seed-text[data-max-lines="multi"]) {
		display: -webkit-box;
		overflow: hidden;
		min-width: 0;
		text-overflow: ellipsis;
		white-space: initial;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: var(--seed-max-lines);
	}
	:global(.seed-text[data-text-decoration-line="none"]) {
		text-decoration-line: none;
	}
	:global(.seed-text[data-text-decoration-line="line-through"]) {
		text-decoration-line: line-through;
	}
	:global(.seed-text[data-text-decoration-line="underline"]) {
		text-decoration-line: underline;
	}
	/* @end recipe */
</style>
