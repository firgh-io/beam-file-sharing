import * as Cloudflare from 'alchemy/Cloudflare';

export const Website = Cloudflare.Website.SvelteKit('beam-frontend', {
	rootDir: import.meta.dirname
});

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;
