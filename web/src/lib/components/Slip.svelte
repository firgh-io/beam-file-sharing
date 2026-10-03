<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		aside,
		children,
		class: className = ''
	}: {
		label: Snippet;
		aside: Snippet;
		children: Snippet;
		class?: string;
	} = $props();
</script>

<div
	class="rounded-base border-hard border-ink bg-paper shadow-card max-xs:shadow-card-sm {className}"
>
	<div
		class="flex items-center justify-between gap-4 border-b-hard border-dashed border-ink px-5 py-3.5"
	>
		<span class="font-mono text-xs font-bold tracking-label">{@render label()}</span>
		{@render aside()}
	</div>
	{@render children()}
</div>
