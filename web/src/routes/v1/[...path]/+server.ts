import type { RequestHandler } from './$types';

export const fallback: RequestHandler = ({ request, platform }) => {
	const beam = platform?.env.BEAM;
	if (!beam) return new Response('Beam binding missing', { status: 502 });

	return beam.fetch(request) as unknown as Promise<Response>;
};
