<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	let { class: className = '', ...rest }: HTMLInputAttributes = $props();
</script>

<input
	class="h-13 w-full rounded-base border-hard border-ink bg-white px-3.5 font-mono text-base font-medium text-ink placeholder:text-placeholder focus:border-ink focus:ring-0 focus:outline-focus {className}"
	{...rest}
/>
