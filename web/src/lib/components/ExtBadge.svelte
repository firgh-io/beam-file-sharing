<script lang="ts">
	type Size = 'md' | 'lg' | 'void';

	let { ext, size = 'md' }: { ext: string; size?: Size } = $props();

	const sizes: Record<Size, string> = {
		md: 'size-15 bg-orange text-sm',
		lg: 'size-24 bg-orange text-[1.375rem]',
		void: 'size-18 border-dashed bg-transparent text-lg text-subtle line-through'
	};
</script>

<span
	class="flex flex-none items-center justify-center border-hard border-ink font-display font-extrabold wide {sizes[
		size
	]}"
>
	{ext}
</span>
