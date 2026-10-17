<script lang="ts">
	import { m } from '#lib/messages.ts';
	import Button from '../Button.svelte';
	import Stat from '../Stat.svelte';
	import StatGrid from '../StatGrid.svelte';

	let {
		name,
		size,
		link,
		slug,
		maxDownloads,
		expiresDate,
		onSendAnother
	}: {
		name: string;
		size: string;
		link: string;
		slug: string;
		maxDownloads?: number;
		expiresDate: string;
		onSendAnother: () => void;
	} = $props();

	let copied = $state(false);

	const copyLink = async () => {
		try {
			await navigator.clipboard.writeText(link);
		} catch {
			return;
		}
		copied = true;
		setTimeout(() => (copied = false), 2000);
	};
</script>

<div class="flex animate-rise flex-col gap-6 p-6 motion-reduce:animate-none">
	<div>
		<span class="inline-block bg-orange px-1.5 py-0.5 font-mono text-xs font-bold tracking-label">
			{m('send_done_tag')}
		</span>
		<h2 class="mt-3 text-headline font-extrabold tracking-display wide">{m('send_done_title')}</h2>
	</div>

	<div class="flex flex-wrap overflow-hidden rounded-base border-hard border-ink bg-white">
		<div
			class="flex min-w-0 flex-[1_1_15rem] items-center px-4 py-3.5 font-mono text-lg font-medium [overflow-wrap:anywhere]"
		>
			{link}
		</div>
		<button
			type="button"
			onclick={copyLink}
			class="grid min-h-14 flex-[1_0_auto] cursor-pointer place-items-center bg-ink px-5 font-mono text-sm font-bold text-paper hover:bg-ink-hover"
		>
			<span class="col-start-1 row-start-1 {copied ? 'invisible' : ''}">{m('send_copy_link')}</span>
			<span class="col-start-1 row-start-1 {copied ? '' : 'invisible'}">{m('send_copied')}</span>
		</button>
		<span role="status" class="sr-only">{copied ? m('send_copied') : ''}</span>
	</div>

	<StatGrid>
		<Stat label={m('send_stat_downloads')}>
			{#snippet value()}{maxDownloads === undefined
					? m('send_stat_unlimited')
					: m('send_stat_max', { max: maxDownloads })}{/snippet}
		</Stat>
		<Stat label={m('send_stat_expires')}>
			{#snippet value()}{expiresDate}{/snippet}
		</Stat>
	</StatGrid>

	<div class="text-[0.9375rem] [overflow-wrap:anywhere] text-body">
		<strong class="text-ink">{name}</strong> · {size}
	</div>

	<div class="flex flex-wrap gap-2.5">
		<Button variant="ghost" href="/file/{slug}">{m('send_see_preview')}</Button>
		<Button variant="ghost" onclick={onSendAnother}>{m('send_another')}</Button>
	</div>
</div>
