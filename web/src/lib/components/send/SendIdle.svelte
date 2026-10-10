<script lang="ts">
	import { m } from '#lib/messages.ts';
	import { validateFile } from '#lib/helper.ts';
	import Icon from '../Icon.svelte';

	let {
		onFileSelect,
		onFileRemove
	}: { onFileSelect: (file: File) => void; onFileRemove: () => void } = $props();

	let errorMessage = $state<string | null>(null);

	const handleFileChange = (e: Event & { currentTarget: HTMLInputElement }) => {
		const input = e.currentTarget;
		const file = input.files?.[0];

		if (!file) {
			errorMessage = null;
			onFileRemove();
			return;
		}

		const result = validateFile(file);

		if (!result.ok) {
			errorMessage = m(result.messageKey, result.params);
			input.value = '';
			return;
		}

		errorMessage = null;
		onFileSelect(file);
	};
</script>

<div class="p-5">
	<label
		class="group flex min-h-80 cursor-pointer flex-col items-center justify-center gap-3.5 rounded-base border-hard border-dashed px-6 py-8 text-center transition-colors duration-150 focus-within:outline-focus hover:bg-drop-hover motion-reduce:transition-none {errorMessage
			? 'border-orange bg-orange-tint hover:bg-orange-tint'
			: 'border-drop-border'}"
	>
		<input
			onchange={handleFileChange}
			type="file"
			class="sr-only"
			aria-invalid={errorMessage ? 'true' : undefined}
			aria-describedby={errorMessage ? 'send-file-error' : undefined}
		/>
		<Icon
			name="upload"
			class="size-16 text-ink transition-transform duration-250 ease-dispatch group-hover:-translate-y-1.5 motion-reduce:transition-none"
		/>
		<span class="text-drop font-extrabold tracking-heading wide">{m('send_drop_title')}</span>
		<span class="text-base text-body">
			{m('send_drop_or')}
			<u class="font-bold text-ink decoration-2 underline-offset-4">
				{m('send_drop_choose')}
			</u>
		</span>
		<span class="mt-1.5 font-mono text-xs tracking-label-sm text-subtle">{m('send_drop_meta')}</span
		>
	</label>

	<div role="alert" class="empty:hidden">
		{#if errorMessage}
			<p
				id="send-file-error"
				class="mt-4 border-l-hard border-orange bg-orange-tint px-3.5 py-2.5 font-mono text-meta font-medium text-ink"
			>
				{errorMessage}
			</p>
		{/if}
	</div>
</div>
