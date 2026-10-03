<script lang="ts">
	import { m } from '#lib/messages.ts';
</script>

<a href="/" class="flex items-center gap-2.5 text-ink no-underline">
	<svg class="size-8" viewBox="0 0 32 32" fill="none" aria-hidden="true">
		<rect x="1.5" y="7.5" width="23" height="23" stroke="currentColor" stroke-width="3" />
		<rect
			class="fill-orange"
			x="9"
			y="1"
			width="22"
			height="22"
			stroke="currentColor"
			stroke-width="2"
		/>
		<path
			d="M15 17 L25 7 M17 7 H25 V15"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="square"
		/>
	</svg>
	<span class="text-2xl font-extrabold tracking-heading wide">{m('brand_name')}</span>
</a>
