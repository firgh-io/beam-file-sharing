<script lang="ts">
	import type { Snippet } from 'svelte';

	let { selected = false, children }: { selected?: boolean; children: Snippet } = $props();
</script>

<button
	type="button"
	aria-pressed={selected}
	class="min-h-9 cursor-pointer rounded-pill border-thin border-ink px-3 font-mono text-meta font-medium hover:bg-ink hover:text-paper {selected
		? 'bg-ink text-paper'
		: 'bg-transparent text-ink'}"
>
	{@render children()}
</button>
