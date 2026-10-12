<script lang="ts">
	import { m, type MessageKey } from '#lib/messages.ts';
	import Barcode from '#lib/components/Barcode.svelte';
	import PageShell from '#lib/components/PageShell.svelte';
	import Slip from '#lib/components/Slip.svelte';
	import StepList from '#lib/components/StepList.svelte';
	import SendIdle from '#lib/components/send/SendIdle.svelte';
	import SendReady from '#lib/components/send/SendReady.svelte';
	import SendUploading from '#lib/components/send/SendUploading.svelte';
	import SendDone from '#lib/components/send/SendDone.svelte';
	import { MAX_EXPIRY_IN_DAYS } from '#lib/limits.ts';
	import {
		addDays,
		formatDateInputValue,
		formatFileSize,
		getFileType,
		toDateInputValue
	} from '#lib/helper.ts';
	import { sendFile, Step, type SendEvent, type SendStep } from '#lib/send/send-file.ts';
	import { sendErrorKey } from '#lib/send/send-error.ts';

	type Phase = 'idle' | 'ready' | 'uploading' | 'done';
	type SentFile = { link: string; maxDownloads?: number; expiresDate: string };

	const statusKeys: Record<SendStep, MessageKey> = {
		[Step.Hashing]: 'send_status_hashing',
		[Step.Initializing]: 'send_status_initializing',
		[Step.Uploading]: 'send_status_uploading',
		[Step.Completing]: 'send_status_completing'
	};

	const defaultExpiresOn = () => toDateInputValue(addDays(new Date(), MAX_EXPIRY_IN_DAYS));

	let currentPhase = $state<Phase>('idle');
	let storedFile = $state.raw<File | null>(null);
	let maxDownloadCount = $state<number>();
	let expiresOn = $state<string | undefined>(defaultExpiresOn());
	let sendEvent = $state<SendEvent>({ step: Step.Hashing });
	let sendError = $state<string | null>(null);
	let sent = $state<SentFile | null>(null);
	let abortController: AbortController | null = null;

	const step = $derived(currentPhase === 'idle' ? 1 : currentPhase === 'done' ? 3 : 2);
	const fileSize = $derived(storedFile ? formatFileSize(storedFile.size) : '');
	const status = $derived(m(statusKeys[sendEvent.step]));
	const uploadProgress = $derived(
		sendEvent.step === Step.Uploading && sendEvent.total
			? Math.round(((sendEvent.loaded ?? 0) / sendEvent.total) * 100)
			: 0
	);

	const handleFileSelect = (file: File) => {
		storedFile = file;
		sendError = null;
		currentPhase = 'ready';
	};

	const handleFileRemove = () => {
		storedFile = null;
		maxDownloadCount = undefined;
		expiresOn = defaultExpiresOn();
		sendError = null;
		currentPhase = 'idle';
	};

	const handleSubmit = async () => {
		if (!storedFile) return;

		const file = storedFile;
		const limits = { maxDownloadCount, expiresOn };
		abortController = new AbortController();
		sendError = null;
		sendEvent = { step: Step.Hashing };
		currentPhase = 'uploading';

		const result = await sendFile(
			file,
			limits,
			(event) => (sendEvent = event),
			abortController.signal
		);
		abortController = null;

		if (result.ok) {
			sent = {
				link: result.link,
				maxDownloads: limits.maxDownloadCount,
				expiresDate: limits.expiresOn
					? formatDateInputValue(limits.expiresOn)
					: m('send_expiry_default', { days: MAX_EXPIRY_IN_DAYS })
			};
			currentPhase = 'done';
		} else {
			if (!result.cancelled) sendError = m(sendErrorKey(result));
			currentPhase = 'ready';
		}
	};

	const handleCancel = () => abortController?.abort();

	const handleSendAnother = () => {
		sent = null;
		handleFileRemove();
	};
</script>

<svelte:head>
	<title>{m('send_page_title')}</title>
</svelte:head>

<PageShell tagline={m('send_tagline')} footnote={m('send_footnote')}>
	<main
		class="mx-auto flex w-full max-w-300 flex-1 flex-wrap items-start gap-10 px-4 pt-6 pb-14 xs:gap-14 xs:px-8 xs:pt-10 xs:pb-18"
	>
		<section class="min-w-0 flex-[1_1_23.75rem] animate-rise pt-3 motion-reduce:animate-none">
			<h1 class="text-hero font-extrabold tracking-display wide">
				{m('send_hero_line1')}
				<span class="mt-2 block">
					{m('send_hero_line2_prefix')}
					<span class="bg-orange box-decoration-clone px-[0.12em]"
						>{m('send_hero_line2_highlight')}</span
					>
				</span>
			</h1>
			<p class="mt-8 max-w-110 text-lg leading-normal text-body">{m('send_lede')}</p>
			<StepList current={step} />
		</section>

		<section
			class="max-w-145 min-w-0 flex-[1_1_28.75rem] animate-rise [animation-delay:80ms] motion-reduce:animate-none"
		>
			<Slip>
				{#snippet label()}
					{m('send_slip_label')} <span class="font-normal">{m('send_slip_number')}</span>
				{/snippet}
				{#snippet aside()}
					<Barcode />
				{/snippet}

				<!-- Send box -->
				{#if currentPhase === 'idle'}
					<SendIdle onFileSelect={handleFileSelect} onFileRemove={handleFileRemove} />
				{:else if currentPhase === 'ready'}
					<SendReady
						name={storedFile?.name ?? ''}
						size={fileSize}
						ext={getFileType(storedFile)}
						errorMessage={sendError}
						onFileRemove={handleFileRemove}
						onSubmit={handleSubmit}
						bind:maxDownloadCount
						bind:expiresOn
					/>
				{:else if currentPhase === 'uploading'}
					<SendUploading
						name={storedFile?.name ?? ''}
						size={fileSize}
						progress={uploadProgress}
						{status}
						onCancel={handleCancel}
					/>
				{:else if sent}
					<SendDone
						name={storedFile?.name ?? ''}
						size={fileSize}
						link={sent.link}
						slug={sent.link.split('/').at(-1) ?? ''}
						maxDownloads={sent.maxDownloads}
						expiresDate={sent.expiresDate}
						onSendAnother={handleSendAnother}
					/>
				{/if}
			</Slip>
		</section>
	</main>
</PageShell>
