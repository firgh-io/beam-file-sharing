<script lang="ts">
	import { m } from '#lib/messages.ts';
	import ProgressBar from '../ProgressBar.svelte';

	let { name, size, progress }: { name: string; size: string; progress: number } = $props();
</script>

<div class="flex min-h-70 flex-col justify-center gap-4.5 px-6 py-10" aria-live="polite">
	<div class="flex items-baseline justify-between">
		<span class="font-mono text-xs font-bold tracking-label">{m('send_uploading_eyebrow')}</span>
		<span class="text-pct font-extrabold tracking-display wide tabular-nums">
			{m('common_percent', { value: progress })}
		</span>
	</div>
	<ProgressBar value={progress} label={m('send_uploading_progress_label')} />
	<div class="text-lg leading-tight font-bold wrap-anywhere">
		{name}
		<span class="font-mono text-meta font-normal text-subtle">{size}</span>
	</div>
	<span class="font-mono text-xs text-subtle">{m('send_uploading_hint')}</span>
</div>
