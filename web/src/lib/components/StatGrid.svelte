<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div
	class="grid grid-cols-2 rounded-base border-hard border-ink bg-white *:min-w-0 [&>*+*]:border-l-hard [&>*+*]:border-ink"
>
	{@render children()}
</div>
