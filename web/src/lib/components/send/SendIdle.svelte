<script lang="ts">
	import { m } from '#lib/messages.ts';
	import Icon from '../Icon.svelte';
</script>

<div class="p-5">
	<label
		class="group flex min-h-80 cursor-pointer flex-col items-center justify-center gap-3.5 rounded-base border-hard border-dashed border-drop-border px-6 py-8 text-center transition-colors duration-150 focus-within:outline-focus hover:bg-drop-hover motion-reduce:transition-none"
	>
		<input type="file" class="sr-only" />
		<Icon
			name="upload"
			class="size-16 text-ink transition-transform duration-250 ease-dispatch group-hover:-translate-y-1.5 motion-reduce:transition-none"
		/>
		<span class="text-drop font-extrabold tracking-heading wide">{m('send_drop_title')}</span>
		<span class="text-base text-body">
			{m('send_drop_or')}
			<u class="font-bold text-ink decoration-[0.125rem] underline-offset-[0.25rem]">
				{m('send_drop_choose')}
			</u>
		</span>
		<span class="mt-1.5 font-mono text-xs tracking-label-sm text-subtle">{m('send_drop_meta')}</span
		>
	</label>
</div>
