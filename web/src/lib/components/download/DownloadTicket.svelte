<script lang="ts">
	import { m } from '#lib/messages.ts';
	import { daysUntil, formatDate } from '#lib/helper.ts';
	import Button from '../Button.svelte';
	import ExtBadge from '../ExtBadge.svelte';
	import Icon from '../Icon.svelte';
	import Segments from '../Segments.svelte';
	import Slip from '../Slip.svelte';
	import Barcode from '../Barcode.svelte';
	import Stat from '../Stat.svelte';
	import StatGrid from '../StatGrid.svelte';

	let {
		phase = 'idle',
		name,
		size,
		ext,
		kind = '',
		link,
		maxDownloads,
		downloadsLeft,
		expiresDate,
		href,
		onDownload
	}: {
		phase?: 'idle' | 'done';
		name: string;
		size: string;
		ext: string;
		kind?: string;
		link: string;
		maxDownloads?: number;
		downloadsLeft?: number;
		expiresDate: Date;
		href: string;
		onDownload?: () => void;
	} = $props();
	let daysUntilExpiry = $derived(daysUntil(expiresDate));
</script>

<Slip class="animate-rise motion-reduce:animate-none">
	{#snippet label()}
		{m('download_slip_label')} <span class="font-normal">{link}</span>
	{/snippet}
	{#snippet aside()}
		<Barcode />
	{/snippet}

	<div class="flex flex-col gap-7 px-4.5 py-6 xs:px-7 xs:pt-8 xs:pb-7">
		<div class="flex flex-wrap items-end gap-5">
			<ExtBadge {ext} size="lg" />
			<div class="min-w-0 flex-[1_1_16.25rem]">
				<h1 class="text-file font-extrabold tracking-display [overflow-wrap:anywhere] wide">
					{name}
				</h1>
				<div class="mt-2.5 font-mono text-meta text-muted">
					{m('download_file_sub', { size, kind })}
				</div>
			</div>
		</div>

		<StatGrid>
			{#if maxDownloads !== undefined && downloadsLeft !== undefined}
				<Stat label={m('download_left_label')} size="lg">
					{#snippet value()}
						{downloadsLeft}
						<small class="text-base font-semibold text-muted">
							{m('download_left_of', { total: maxDownloads })}
						</small>
					{/snippet}
					<Segments total={maxDownloads} remaining={downloadsLeft} />
				</Stat>
			{/if}
			<Stat label={m('download_expires_label')} size="lg">
				{#snippet value()}{daysUntilExpiry <= 1
						? m('donwload_expires_tomorrow')
						: m('download_expires_in_days', {
								days: daysUntilExpiry
							})}{/snippet}
				<div class="font-mono text-meta text-muted">{formatDate(expiresDate)}</div>
			</Stat>
		</StatGrid>

		<div aria-live="polite">
			{#if phase === 'idle'}
				<Button variant="cta-lg" {href} download onclick={onDownload}>
					<span>{m('download_cta')}</span>
					<span class="flex items-center gap-3.5">
						<span class="font-mono text-sm font-medium tracking-normal">{size}</span>
						<Icon
							name="download"
							class="h-7.5 w-6.5 transition-transform duration-250 ease-dispatch group-hover:translate-y-1 motion-reduce:transition-none"
						/>
					</span>
				</Button>
			{:else}
				<div
					class="flex animate-rise flex-wrap items-center justify-between gap-4 rounded-base border-hard border-ink bg-ink px-5 py-4.5 text-paper motion-reduce:animate-none"
				>
					<div class="flex items-center gap-3.5">
						<Icon name="check" class="size-8 text-ink" />
						<div>
							<div class="text-xl font-extrabold wide">{m('download_done_title')}</div>
							<div class="mt-0.5 text-sm text-on-ink-muted">{m('download_done_sub')}</div>
						</div>
					</div>
					{#if downloadsLeft !== 0}
						<Button {href} download variant="ghost-on-ink" onclick={onDownload}>
							{m('download_again')}
						</Button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</Slip>
