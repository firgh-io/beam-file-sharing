<script lang="ts">
	import type { Snippet } from 'svelte';
	import { m } from '#lib/messages.ts';
	import Logo from './Logo.svelte';

	let { tagline, footnote, children }: { tagline: string; footnote: string; children: Snippet } =
		$props();
</script>

<div class="flex min-h-screen flex-col dot-grid">
	<header
		class="mx-auto flex w-full max-w-300 flex-wrap items-center justify-between gap-3 px-4 py-6 xs:px-8"
	>
		<Logo />
		<span class="font-mono text-meta text-muted">{tagline}</span>
	</header>

	{@render children()}

	<footer
		class="mx-auto flex w-full max-w-300 flex-wrap items-center justify-between gap-3 border-t-thin border-rule px-4 pt-5 pb-8 font-mono text-xs text-muted xs:px-8"
	>
		<span>{footnote}</span>
		<span>{m('common_copyright')}</span>
	</footer>
</div>
