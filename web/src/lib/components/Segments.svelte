<script lang="ts">
	let { total, remaining }: { total: number; remaining: number } = $props();
</script>

<div class="flex gap-1" aria-hidden="true">
	{#each { length: total } as _, i (i)}
		<span class="h-2.5 flex-1 border-thin border-ink {i < remaining ? 'bg-ink' : ''}"></span>
	{/each}
</div>
