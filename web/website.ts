import * as Cloudflare from 'alchemy/Cloudflare';
import { Beam } from '../backend/workers/beam-worker';
import { Effect } from 'effect';

export const Website = Cloudflare.Website.SvelteKit(
	'beam-frontend',
	Effect.gen(function* () {
		const beam = yield* Beam;
		return { rootDir: import.meta.dirname, env: { BEAM: beam } };
	})
);

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;
