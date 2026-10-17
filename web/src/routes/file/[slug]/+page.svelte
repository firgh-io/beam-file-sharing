<script lang="ts">
	import { m } from '#lib/messages.ts';
	import PageShell from '#lib/components/PageShell.svelte';
	import DownloadTicket from '#lib/components/download/DownloadTicket.svelte';
	import type { PageProps } from './$types';
	import { sampleFile } from '#lib/sample.ts';
	import { formatFileSize, getFileTypeFromMime } from '#lib/helper.ts';

	let { data }: PageProps = $props();
	let {
		file: { fileName, fileSize, fileType, maxDownloadCount, expiresAt, downloadsLeft }
	} = $derived(data);
	let formattedExpiresAt = $derived(new Date(expiresAt));
</script>

<svelte:head>
	<title>{m('download_page_title')}</title>
</svelte:head>

<PageShell tagline={m('download_tagline')} footnote={m('download_footnote')}>
	<main class="mx-auto w-full max-w-170 flex-1 px-4 pt-4 pb-14 xs:px-6 xs:pt-8 xs:pb-18">
		<DownloadTicket
			name={fileName}
			size={formatFileSize(fileSize)}
			ext={getFileTypeFromMime(fileType)}
			kind={sampleFile.kind}
			link={sampleFile.link}
			maxDownloads={maxDownloadCount}
			{downloadsLeft}
			expiresDate={formattedExpiresAt}
		/>
		<p
			class="mt-7 max-w-full animate-rise px-1 font-mono text-xs leading-relaxed text-muted [animation-delay:80ms] motion-reduce:animate-none"
		>
			{m('download_fineprint')}
		</p>
	</main>
</PageShell>
