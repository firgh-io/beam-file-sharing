<script lang="ts">
	import { m } from '#lib/messages.ts';
	import { sampleFile } from '#lib/sample.ts';
	import { addDays } from '#lib/helper.ts';
	import Barcode from '#lib/components/Barcode.svelte';
	import Button from '#lib/components/Button.svelte';
	import PageShell from '#lib/components/PageShell.svelte';
	import Slip from '#lib/components/Slip.svelte';
	import SendIdle from '#lib/components/send/SendIdle.svelte';
	import SendReady from '#lib/components/send/SendReady.svelte';
	import SendUploading from '#lib/components/send/SendUploading.svelte';
	import SendDone from '#lib/components/send/SendDone.svelte';
	import DownloadTicket from '#lib/components/download/DownloadTicket.svelte';
	import DownloadGone from '#lib/components/download/DownloadGone.svelte';

	const swatches = [
		['ground', 'bg-ground'],
		['paper', 'bg-paper'],
		['white', 'bg-white'],
		['ink', 'bg-ink'],
		['ink-hover', 'bg-ink-hover'],
		['body', 'bg-body'],
		['muted', 'bg-muted'],
		['subtle', 'bg-subtle'],
		['placeholder', 'bg-placeholder'],
		['orange', 'bg-orange'],
		['orange-tint', 'bg-orange-tint'],
		['link-hover', 'bg-link-hover'],
		['on-ink-muted', 'bg-on-ink-muted']
	] as const;

	const f = sampleFile;
	const ticket = {
		name: f.name,
		size: f.size,
		ext: f.ext,
		kind: f.kind,
		link: f.link,
		maxDownloads: f.maxDownloads,
		downloadsLeft: f.downloadsLeft,
		href: '#',
		expiresDate: addDays(new Date(), f.expiresInDays)
	};
</script>

<svelte:head>
	<title>{m('design_page_title')}</title>
</svelte:head>

{#snippet sendSlip(title: string, body: import('svelte').Snippet)}
	<div class="flex flex-col gap-3">
		<h3 class="font-mono text-xs font-bold tracking-label">{title}</h3>
		<Slip>
			{#snippet label()}
				{m('send_slip_label')} <span class="font-normal">{m('send_slip_number')}</span>
			{/snippet}
			{#snippet aside()}
				<Barcode />
			{/snippet}
			{@render body()}
		</Slip>
	</div>
{/snippet}

{#snippet stateTitle(title: string)}
	<h3 class="font-mono text-xs font-bold tracking-label">{title}</h3>
{/snippet}

<PageShell tagline={m('design_tagline')} footnote={m('design_footnote')}>
	<main
		class="mx-auto flex w-full max-w-300 flex-1 flex-col gap-14 px-4 pt-6 pb-14 xs:px-8 xs:pb-18"
	>
		<section class="flex flex-col gap-4">
			<h2 class="text-headline font-extrabold tracking-display wide">{m('design_colours')}</h2>
			<ul class="grid grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))] gap-3">
				{#each swatches as [name, bg] (name)}
					<li class="overflow-hidden rounded-base border-hard border-ink bg-white">
						<div class="h-14 border-b-hard border-ink {bg}"></div>
						<div class="p-2 font-mono text-micro">{name}</div>
					</li>
				{/each}
			</ul>
		</section>

		<section class="flex flex-col gap-4">
			<h2 class="text-headline font-extrabold tracking-display wide">{m('design_buttons')}</h2>
			<div class="flex flex-wrap items-center gap-4">
				<Button class="max-w-72">{m('send_create_link')}</Button>
				<Button variant="ghost">{m('send_another')}</Button>
				<div class="rounded-base bg-ink p-3">
					<Button variant="ghost-on-ink">{m('download_again')}</Button>
				</div>
			</div>
		</section>

		<section class="flex flex-col gap-6">
			<h2 class="text-headline font-extrabold tracking-display wide">{m('design_send_states')}</h2>
			<div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,25rem),1fr))] items-start gap-10">
				{#snippet idle()}<SendIdle onFileSelect={() => {}} onFileRemove={() => {}} />{/snippet}
				{#snippet ready()}<SendReady
						name={f.name}
						size={f.size}
						ext={f.ext}
						onFileRemove={() => {}}
						onSubmit={() => {}}
					/>{/snippet}
				{#snippet uploading()}<SendUploading
						name={f.name}
						size={f.size}
						progress={f.progress}
						status={m('send_status_uploading')}
						onCancel={() => {}}
					/>{/snippet}
				{#snippet done()}
					<SendDone
						name={f.name}
						size={f.size}
						link={f.link}
						slug={f.slug}
						maxDownloads={f.maxDownloads}
						expiresDate={f.expiresDate}
						onSendAnother={() => {}}
					/>
				{/snippet}
				{@render sendSlip(m('design_state_idle'), idle)}
				{@render sendSlip(m('design_state_ready'), ready)}
				{@render sendSlip(m('design_state_uploading'), uploading)}
				{@render sendSlip(m('design_state_done'), done)}
			</div>
		</section>

		<section class="flex flex-col gap-6">
			<h2 class="text-headline font-extrabold tracking-display wide">
				{m('design_download_states')}
			</h2>
			<div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,25rem),1fr))] items-start gap-10">
				<div class="flex flex-col gap-3">
					{@render stateTitle(m('design_state_live'))}
					<DownloadTicket {...ticket} />
				</div>
				<div class="flex flex-col gap-3">
					{@render stateTitle(m('design_state_unlimited'))}
					<DownloadTicket {...ticket} maxDownloads={undefined} downloadsLeft={undefined} />
				</div>
				<div class="flex flex-col gap-3">
					{@render stateTitle(m('design_state_downloaded'))}
					<DownloadTicket {...ticket} phase="done" />
				</div>
				<div class="flex flex-col gap-3">
					{@render stateTitle(m('design_state_expired'))}
					<DownloadGone reason="expired" name={f.name} ext={f.ext} link={f.link} />
				</div>
				<div class="flex flex-col gap-3">
					{@render stateTitle(m('design_state_limit'))}
					<DownloadGone reason="limit" name={f.name} ext={f.ext} link={f.link} />
				</div>
			</div>
		</section>
	</main>
</PageShell>
