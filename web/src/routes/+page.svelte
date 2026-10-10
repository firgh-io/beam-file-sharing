<script lang="ts">
	import { m } from '#lib/messages.ts';
	import Barcode from '#lib/components/Barcode.svelte';
	import PageShell from '#lib/components/PageShell.svelte';
	import Slip from '#lib/components/Slip.svelte';
	import StepList from '#lib/components/StepList.svelte';
	import SendIdle from '#lib/components/send/SendIdle.svelte';
	import SendReady from '#lib/components/send/SendReady.svelte';
	import SendUploading from '#lib/components/send/SendUploading.svelte';
	import SendDone from '#lib/components/send/SendDone.svelte';
	import { MAX_EXPIRY_IN_DAYS } from '#lib/limits.ts';
	import { addDays, getFileType, toDateInputValue } from '#lib/helper.ts';

	type Phase = 'idle' | 'ready' | 'uploading' | 'done';
	let currentPhase = $state<Phase>('idle');
	let storedFile = $state.raw<File | null>(null);
	let maxDownloadCount = $state<number>();
	const defaultExpiresOn = () => toDateInputValue(addDays(new Date(), MAX_EXPIRY_IN_DAYS));
	let expiresOn = $state<string | undefined>(defaultExpiresOn());
	const step = $derived(currentPhase === 'idle' ? 1 : currentPhase === 'done' ? 3 : 2);

	const handleFileSelect = (file: File) => {
		storedFile = file;
		currentPhase = 'ready';
	};

	const handleFileRemove = () => {
		storedFile = null;
		maxDownloadCount = undefined;
		expiresOn = defaultExpiresOn();
		currentPhase = 'idle';
	};
</script>

<!-- TO DO: -->
<!-- Create link calls Upload  -->
<!-- Get back presigned URL -->
<!-- Upload to R2 -->
<!-- Call complete -->

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
						size={storedFile?.size?.toString() ?? ''}
						ext={getFileType(storedFile)}
						onFileRemove={handleFileRemove}
						bind:maxDownloadCount
						bind:expiresOn
					/>
				{:else if currentPhase === 'uploading'}
					<SendUploading
						name={storedFile?.name ?? ''}
						size={storedFile?.size?.toString() ?? ''}
						progress={5}
					/>
				{:else}
					<SendDone name="" size="" link="" slug="" maxDownloads={0} expiresDate={''} />
				{/if}
			</Slip>
		</section>
	</main>
</PageShell>
