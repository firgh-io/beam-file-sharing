<script lang="ts">
	type Name = 'upload' | 'arrow-right' | 'download' | 'close' | 'check';

	let { name, class: className = 'size-6' }: { name: Name; class?: string } = $props();
</script>

{#if name === 'upload'}
	<svg class={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
		<path
			d="M32 40 V8 M18 22 L32 8 L46 22"
			stroke="currentColor"
			stroke-width="3.5"
			stroke-linecap="square"
		/>
		<path d="M8 38 V56 H56 V38" stroke="currentColor" stroke-width="3.5" />
		<rect class="fill-orange" x="22" y="46" width="20" height="4" />
	</svg>
{:else if name === 'arrow-right'}
	<svg class={className} viewBox="0 0 28 20" fill="none" aria-hidden="true">
		<path d="M0 10 H25 M17 2 L25 10 L17 18" stroke="currentColor" stroke-width="3" />
	</svg>
{:else if name === 'download'}
	<svg class={className} viewBox="0 0 26 30" fill="none" aria-hidden="true">
		<path d="M13 0 V21 M4 13 L13 22 L22 13" stroke="currentColor" stroke-width="3.2" />
		<path d="M1 28 H25" stroke="currentColor" stroke-width="3.2" />
	</svg>
{:else if name === 'close'}
	<svg class={className} viewBox="0 0 18 18" fill="none" aria-hidden="true">
		<path d="M3 3 L15 15 M15 3 L3 15" stroke="currentColor" stroke-width="2.5" />
	</svg>
{:else}
	<svg class={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
		<rect class="fill-orange" x="1" y="1" width="30" height="30" />
		<path d="M8 16.5 L13.5 22 L24 10" stroke="currentColor" stroke-width="3.2" />
	</svg>
{/if}
