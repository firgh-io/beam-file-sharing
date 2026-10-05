<script lang="ts">
	import { m } from '#lib/messages.ts';
	import Button from '../Button.svelte';
	import Chip from '../Chip.svelte';
	import ExtBadge from '../ExtBadge.svelte';
	import Icon from '../Icon.svelte';
	import TextField from '../TextField.svelte';

	let { name, size, ext }: { name: string; size: string; ext: string } = $props();

	const maxDownloadChips = [1, 5, 10, 25];
</script>

<div class="flex animate-rise flex-col gap-6 p-6 motion-reduce:animate-none">
	<div class="flex items-center gap-4">
		<ExtBadge {ext} />
		<div class="min-w-0 flex-1">
			<div class="text-lg leading-tight font-bold [overflow-wrap:anywhere]">{name}</div>
			<div class="mt-1 font-mono text-meta text-subtle">{size}</div>
		</div>
		<button
			type="button"
			aria-label={m('common_remove_file')}
			class="flex size-11 flex-none cursor-pointer items-center justify-center rounded-base border-hard border-ink bg-transparent text-ink hover:bg-ink hover:text-paper"
		>
			<Icon name="close" class="size-4.5" />
		</button>
	</div>

	<div class="-mx-6 border-t-hard border-dashed border-ink"></div>

	<div class="flex flex-wrap gap-6">
		<div class="flex min-w-0 flex-[1_1_13.75rem] flex-col gap-2.5">
			<label
				for="max-downloads"
				class="flex items-baseline justify-between text-[0.9375rem] font-bold"
			>
				{m('send_max_label')}
				<span class="font-mono text-micro font-normal text-subtle">{m('send_optional')}</span>
			</label>
			<TextField
				id="max-downloads"
				type="number"
				min="1"
				inputmode="numeric"
				placeholder={m('send_max_placeholder')}
			/>
			<div class="flex flex-wrap gap-1.5">
				{#each maxDownloadChips as count (count)}
					<Chip>{count}</Chip>
				{/each}
				<Chip selected>{m('send_chip_no_limit')}</Chip>
			</div>
		</div>

		<div class="flex min-w-0 flex-[1_1_13.75rem] flex-col gap-2.5">
			<label
				for="expires-on"
				class="flex items-baseline justify-between text-[0.9375rem] font-bold"
			>
				{m('send_expires_label')}
				<span class="font-mono text-micro font-normal text-subtle">{m('send_optional')}</span>
			</label>
			<TextField id="expires-on" type="date" />
			<div class="flex flex-wrap gap-1.5">
				<Chip>{m('send_chip_tomorrow')}</Chip>
				<Chip>{m('send_chip_7_days')}</Chip>
				<Chip selected>{m('send_chip_never')}</Chip>
			</div>
		</div>
	</div>

	<div class="flex flex-col gap-3">
		<Button>
			<span>{m('send_create_link')}</span>
			<Icon
				name="arrow-right"
				class="h-5 w-7 transition-transform duration-250 ease-dispatch group-hover:translate-y-1 motion-reduce:transition-none"
			/>
		</Button>
		<p class="font-mono text-meta text-muted">{m('send_summary_unlimited')}</p>
	</div>
</div>
