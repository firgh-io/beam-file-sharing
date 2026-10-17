<script lang="ts">
	import { m } from '#lib/messages.ts';
	import PageShell from '#lib/components/PageShell.svelte';
	import DownloadTicket from '#lib/components/download/DownloadTicket.svelte';
	import DownloadGone from '#lib/components/download/DownloadGone.svelte';
	import type { PageProps } from './$types';
	import { sampleFile } from '#lib/sample.ts';
	import { formatFileSize, getFileTypeFromMime } from '#lib/helper.ts';
	import { downloadUrl } from '#lib/api/beam.ts';
	import { invalidate } from '$app/navigation';
	import { DEPENDENCY } from '#lib/dependencies.ts';

	let { data }: PageProps = $props();
	let {
		file: { fileName, fileSize, fileType, maxDownloadCount, expiresAt, downloadsLeft }
	} = $derived(data);
	let formattedExpiresAt = $derived(new Date(expiresAt));
	let phase = $state<'idle' | 'done'>('idle');
	let goneReason = $derived<'expired' | 'limit' | undefined>(
		formattedExpiresAt < new Date() ? 'expired' : downloadsLeft === 0 ? 'limit' : undefined
	);

	// The browser fires the download request on click; wait so the backend has counted it before re-reading
	const REFRESH_DELAY_MS = 1000;

	const onDownload = () => {
		phase = 'done';
		setTimeout(() => invalidate(DEPENDENCY.file), REFRESH_DELAY_MS);
	};
</script>

<svelte:head>
	<title>{m('download_page_title')}</title>
</svelte:head>

<PageShell tagline={m('download_tagline')} footnote={m('download_footnote')}>
	<main class="mx-auto w-full max-w-170 flex-1 px-4 pt-4 pb-14 xs:px-6 xs:pt-8 xs:pb-18">
		{#if phase === 'idle' && goneReason}
			<DownloadGone
				reason={goneReason}
				name={fileName}
				ext={getFileTypeFromMime(fileType)}
				link={sampleFile.link}
			/>
		{:else}
			<DownloadTicket
				name={fileName}
				size={formatFileSize(fileSize)}
				ext={getFileTypeFromMime(fileType)}
				link={sampleFile.link}
				maxDownloads={maxDownloadCount}
				{downloadsLeft}
				expiresDate={formattedExpiresAt}
				{phase}
				href={downloadUrl(data.fileId)}
				{onDownload}
			/>
		{/if}
		<p
			class="mt-7 max-w-full animate-rise px-1 font-mono text-xs leading-relaxed text-muted [animation-delay:80ms] motion-reduce:animate-none"
		>
			{m('download_fineprint')}
		</p>
	</main>
</PageShell>
