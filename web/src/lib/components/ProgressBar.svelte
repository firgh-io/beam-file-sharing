<script lang="ts">
	let {
		value,
		label,
		size = 'md'
	}: { value: number; label: string; size?: 'md' | 'lg' } = $props();
</script>

<div
	class="overflow-hidden border-hard border-ink bg-white {size === 'lg' ? 'h-5.5' : 'h-4.5'}"
	role="progressbar"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={100}
	aria-valuenow={value}
>
	<div
		class="h-full border-r-hard border-ink bg-orange transition-[width] duration-100 ease-linear motion-reduce:transition-none"
		style:width="{value}%"
	></div>
</div>
