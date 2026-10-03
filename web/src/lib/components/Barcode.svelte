<script lang="ts">
	const widths = [2, 5, 2, 3, 2, 2, 5, 3, 2, 3, 5, 2, 2, 3, 2, 5, 3, 2, 2, 5, 2, 3, 3, 5] as const;
	const widthClass = { 2: 'w-0.5', 3: 'w-[0.1875rem]', 5: 'w-[0.3125rem]' } as const;
</script>

<span class="flex h-5.5 items-center gap-0.5 overflow-hidden" aria-hidden="true">
	{#each widths as width, i (i)}
		<span class="h-5.5 bg-ink {widthClass[width]}"></span>
	{/each}
</span>
