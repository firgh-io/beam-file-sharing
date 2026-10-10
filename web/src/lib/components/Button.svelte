<script lang="ts">
	import type { Snippet } from 'svelte';

	type Variant = 'cta' | 'cta-lg' | 'ghost' | 'ghost-on-ink';

	let {
		variant = 'cta',
		href,
		class: className = '',
		children,
		onclick
	}: {
		variant?: Variant;
		href?: string;
		class?: string;
		children: Snippet;
		onclick?: () => void;
	} = $props();

	const cta =
		'group flex w-full cursor-pointer items-center justify-between gap-4 rounded-base border-hard border-ink bg-orange font-display font-extrabold text-ink wide transition-[transform,box-shadow] duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-btn-hover active:translate-x-1 active:translate-y-1 active:shadow-none motion-reduce:transition-none';
	const ghost =
		'inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-base border-hard bg-transparent px-4.5 font-display text-[0.9375rem] font-bold no-underline';

	const variants: Record<Variant, string> = {
		cta: `${cta} min-h-16 px-5.5 text-xl shadow-btn`,
		'cta-lg': `${cta} min-h-19 px-6 text-2xl tracking-[-0.01em] shadow-btn-lg`,
		ghost: `${ghost} border-ink text-ink hover:bg-ink hover:text-paper`,
		'ghost-on-ink': `${ghost} border-paper text-paper hover:bg-paper hover:text-ink`
	};
</script>

<svelte:element
	this={href ? 'a' : 'button'}
	{href}
	type={href ? undefined : 'button'}
	class="{variants[variant]} {className}"
	{onclick}
	role="button"
	tabindex="0"
>
	{@render children()}
</svelte:element>
