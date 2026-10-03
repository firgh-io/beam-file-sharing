<script lang="ts">
	import { m } from '#lib/messages.ts';

	let { current }: { current: 1 | 2 | 3 } = $props();

	const steps = [
		{ n: 1, label: 'send_step_1' },
		{ n: 2, label: 'send_step_2' },
		{ n: 3, label: 'send_step_3' }
	] as const;
</script>

<ol class="mt-10 max-w-110 border-b-thin border-rule">
	{#each steps as step (step.n)}
		<li
			class="flex items-baseline gap-4 border-t-thin border-rule py-3.5 {step.n < current
				? 'text-ink line-through decoration-[0.125rem]'
				: step.n === current
					? 'text-ink'
					: 'text-subtle'}"
			aria-current={step.n === current ? 'step' : undefined}
		>
			<span
				class="font-mono text-meta font-bold {step.n === current
					? 'bg-orange px-1.5 text-ink'
					: ''}"
			>
				{String(step.n).padStart(2, '0')}
			</span>
			<span class="text-lg font-bold">{m(step.label)}</span>
		</li>
	{/each}
</ol>
