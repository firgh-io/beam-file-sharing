<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { m } from '#lib/messages.ts';
	import Button from '../Button.svelte';
	import ProgressBar from '../ProgressBar.svelte';

	let {
		name,
		size,
		progress,
		status,
		onCancel
	}: {
		name: string;
		size: string;
		progress: number;
		status: string;
		onCancel: () => void;
	} = $props();

	const shown = new Tween(0, { duration: 400, easing: cubicOut });

	$effect(() => {
		shown.target = progress;
	});
</script>

<div class="flex min-h-70 flex-col justify-center gap-4.5 px-6 py-10">
	<div class="flex items-baseline justify-between">
		<span role="status" class="font-mono text-xs font-bold tracking-label">{status}</span>
		<span class="text-pct font-extrabold tracking-display wide tabular-nums">
			{m('common_percent', { value: Math.round(shown.current) })}
		</span>
	</div>
	<ProgressBar value={shown.current} label={m('send_uploading_progress_label')} />
	<div class="text-lg leading-tight font-bold wrap-anywhere">
		{name}
		<span class="font-mono text-meta font-normal text-subtle">{size}</span>
	</div>
	<span class="font-mono text-xs text-subtle">{m('send_uploading_hint')}</span>
	<div>
		<Button variant="ghost" onclick={onCancel}>{m('send_cancel')}</Button>
	</div>
</div>
