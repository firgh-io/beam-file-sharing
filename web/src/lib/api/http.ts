export type Aborted = { kind: 'aborted' };
export type ApiError<Err> = { kind: 'network' } | { kind: 'rejected'; status: number; body?: Err };
export type ApiResult<Ok, Err> =
	{ ok: true; data: Ok } | { ok: false; error: ApiError<Err> | Aborted };

export const post = async <Ok, Err>(
	path: string,
	{ body, signal }: { body?: unknown; signal?: AbortSignal } = {}
): Promise<ApiResult<Ok, Err>> => {
	try {
		const res = await fetch(path, {
			method: 'POST',
			headers: body ? { 'content-type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined,
			signal
		});
		if (res.ok) return { ok: true, data: await res.json() };

		return {
			ok: false,
			error: {
				kind: 'rejected',
				status: res.status,
				body: await res.json().catch(() => undefined)
			}
		};
	} catch {
		return { ok: false, error: signal?.aborted ? { kind: 'aborted' } : { kind: 'network' } };
	}
};
