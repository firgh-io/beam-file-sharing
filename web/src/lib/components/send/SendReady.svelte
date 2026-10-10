<script lang="ts">
	import { MAX_EXPIRY_IN_DAYS } from '#lib/limits.ts';
	import { m } from '#lib/messages.ts';
	import {
		addDays,
		formatDateInputValue,
		toDateInputValue,
		validateExpiresOn,
		validateMaxDownloadCount
	} from '#lib/helper.ts';
	import Button from '../Button.svelte';
	import Chip from '../Chip.svelte';
	import ExtBadge from '../ExtBadge.svelte';
	import Icon from '../Icon.svelte';
	import TextField from '../TextField.svelte';

	let {
		name,
		size,
		ext,
		maxDownloadCount = $bindable(),
		expiresOn = $bindable(),
		onFileRemove
	}: {
		name: string;
		size: string;
		ext: string;
		maxDownloadCount?: number;
		expiresOn?: string;
		onFileRemove: () => void;
	} = $props();

	const maxDownloadChips = [1, 5, 10, 25];

	const expiryChips = [
		{ label: 'send_chip_tomorrow', days: 1 },
		{ label: 'send_chip_7_days', days: 7 }
	] as const;

	const today = new Date();
	const minExpiresOn = toDateInputValue(today);
	const maxExpiresOn = toDateInputValue(addDays(today, MAX_EXPIRY_IN_DAYS));

	const maxDownloadsValidation = $derived(validateMaxDownloadCount(maxDownloadCount));
	const expiresOnValidation = $derived(validateExpiresOn(expiresOn, today));
	const errorMessage = $derived(
		maxDownloadsValidation.ok ? null : m(maxDownloadsValidation.messageKey)
	);
	const expiresOnError = $derived(
		expiresOnValidation.ok ? null : m(expiresOnValidation.messageKey, expiresOnValidation.params)
	);
	const summary = $derived.by(() => {
		const expiry =
			expiresOn && expiresOnValidation.ok
				? m('send_expiry_on', { date: formatDateInputValue(expiresOn) })
				: m('send_expiry_default', { days: MAX_EXPIRY_IN_DAYS });
		if (maxDownloadCount === undefined || !maxDownloadsValidation.ok) {
			return m('send_summary_unlimited', { expiry });
		}
		return m(maxDownloadCount === 1 ? 'send_summary_limited_one' : 'send_summary_limited_other', {
			expiry,
			count: maxDownloadCount
		});
	});
</script>

<div class="flex animate-rise flex-col gap-6 p-6 motion-reduce:animate-none">
	<div class="flex items-center gap-4">
		<ExtBadge {ext} />
		<div class="min-w-0 flex-1">
			{#key name}
				<div class="text-lg leading-tight font-bold wrap-anywhere">{name}</div>
			{/key}

			{#key size}
				<div class="mt-1 font-mono text-meta text-subtle">{size}</div>
			{/key}
		</div>
		<button
			type="button"
			aria-label={m('common_remove_file')}
			onclick={onFileRemove}
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
				value={maxDownloadCount ?? ''}
				oninput={(e) => {
					const value = e.currentTarget.valueAsNumber;
					maxDownloadCount = Number.isNaN(value) ? undefined : value;
				}}
				aria-invalid={errorMessage ? 'true' : undefined}
				aria-describedby={errorMessage ? 'max-downloads-error' : undefined}
			/>
			<div role="alert" class="empty:hidden">
				{#if errorMessage}
					<p
						id="max-downloads-error"
						class="border-l-hard border-orange bg-orange-tint px-3 py-2 font-mono text-meta font-medium text-ink"
					>
						{errorMessage}
					</p>
				{/if}
			</div>
			<div class="flex flex-wrap gap-1.5">
				{#each maxDownloadChips as count (count)}
					<Chip selected={maxDownloadCount === count} onclick={() => (maxDownloadCount = count)}>
						{count}
					</Chip>
				{/each}
				<Chip
					selected={maxDownloadCount === undefined}
					onclick={() => (maxDownloadCount = undefined)}
				>
					{m('send_chip_no_limit')}
				</Chip>
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
			<TextField
				id="expires-on"
				type="date"
				min={minExpiresOn}
				max={maxExpiresOn}
				value={expiresOn ?? ''}
				oninput={(e) => (expiresOn = e.currentTarget.value || undefined)}
				aria-invalid={expiresOnError ? 'true' : undefined}
				aria-describedby={expiresOnError ? 'expires-on-error' : undefined}
			/>
			<div role="alert" class="empty:hidden">
				{#if expiresOnError}
					<p
						id="expires-on-error"
						class="border-l-hard border-orange bg-orange-tint px-3 py-2 font-mono text-meta font-medium text-ink"
					>
						{expiresOnError}
					</p>
				{/if}
			</div>
			<div class="flex flex-wrap gap-1.5">
				{#each expiryChips as { label, days } (days)}
					{@const value = toDateInputValue(addDays(today, days))}
					<Chip selected={expiresOn === value} onclick={() => (expiresOn = value)}>
						{m(label)}
					</Chip>
				{/each}
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
		<p class="font-mono text-meta text-muted">{summary}</p>
	</div>
</div>
