<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		size = 'md',
		value,
		children
	}: { label: string; size?: 'md' | 'lg'; value: Snippet; children?: Snippet } = $props();
</script>

<div class="flex flex-col gap-2 p-4">
	<div class="font-mono text-micro tracking-label-sm text-subtle">{label}</div>
	<div
		class="font-display font-extrabold tracking-heading wide {size === 'lg'
			? 'text-stat-lg'
			: 'text-stat'}"
	>
		{@render value()}
	</div>
	{@render children?.()}
</div>
