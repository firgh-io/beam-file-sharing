import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { getFile } from '#lib/api/beam.ts';
import { DEPENDENCY } from '#lib/dependencies.ts';

export const load = (async ({ params, fetch, depends }) => {
	depends(DEPENDENCY.file);
	const fileRes = await getFile(params.slug, fetch);

	if (!fileRes.ok) {
		const { error: apiError } = fileRes;
		if (apiError.kind === 'rejected') {
			error(apiError.status, apiError.body?.id ?? apiError.kind);
		}
		error(503, apiError.kind);
	}

	const { data: file } = fileRes;

	// The wire format encodes absent optionals as null even though the schema types them as undefined
	return {
		fileId: params.slug,
		file: {
			...file,
			maxDownloadCount: file.maxDownloadCount ?? undefined,
			downloadsLeft: file.downloadsLeft ?? undefined
		}
	};
}) satisfies PageLoad;
