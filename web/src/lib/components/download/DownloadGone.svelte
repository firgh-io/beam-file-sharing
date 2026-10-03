<script lang="ts">
	import { m } from '#lib/messages.ts';
	import Button from '../Button.svelte';
	import ExtBadge from '../ExtBadge.svelte';
	import Slip from '../Slip.svelte';

	let {
		reason,
		name,
		ext,
		link
	}: { reason: 'expired' | 'limit'; name: string; ext: string; link: string } = $props();

	const copy = $derived(
		reason === 'expired'
			? {
					stamp: m('gone_stamp_expired'),
					title: m('gone_title_expired'),
					body: m('gone_body_expired')
				}
			: {
					stamp: m('gone_stamp_limit'),
					title: m('gone_title_limit'),
					body: m('gone_body_limit')
				}
	);
</script>

<Slip class="animate-rise motion-reduce:animate-none">
	{#snippet label()}
		{m('gone_slip_label')} <span class="font-normal">{link}</span>
	{/snippet}
	{#snippet aside()}
		<span
			class="-rotate-4 border-hard border-ink px-2 py-0.5 font-mono text-xs font-bold tracking-label"
		>
			{copy.stamp}
		</span>
	{/snippet}

	<div class="flex flex-col gap-5.5 px-4.5 py-6 xs:px-7 xs:pt-8 xs:pb-7">
		<div class="flex items-center gap-4.5">
			<ExtBadge {ext} size="void" />
			<span class="font-mono text-sm [overflow-wrap:anywhere] text-muted line-through">{name}</span>
		</div>
		<h1 class="text-gone font-extrabold tracking-display wide">{copy.title}</h1>
		<p class="max-w-115 text-[1.0625rem] leading-normal text-body">
			{copy.body}
			{m('gone_ask_again')}
		</p>
		<div>
			<Button variant="ghost" href="/">{m('gone_send_own')}</Button>
		</div>
	</div>
</Slip>
