import type { Aborted } from './http';

export type R2UploadError = { kind: 'network' } | { kind: 'rejected'; status: number };
export type R2UploadResult = { ok: true } | { ok: false; error: R2UploadError | Aborted };

// XHR instead of fetch: fetch has no upload progress events
export const uploadToR2 = (
	presignedUrl: string,
	file: File,
	fileType: string,
	onProgress: (loaded: number, total: number) => void,
	signal?: AbortSignal
): Promise<R2UploadResult> =>
	new Promise((resolve) => {
		if (signal?.aborted) return resolve({ ok: false, error: { kind: 'aborted' } });

		const xhr = new XMLHttpRequest();

		const abort = () => xhr.abort();
		const finish = (result: R2UploadResult) => {
			signal?.removeEventListener('abort', abort);
			resolve(result);
		};

		xhr.open('PUT', presignedUrl);
		xhr.setRequestHeader('Content-Type', fileType);
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress(e.loaded, e.total);
		};
		xhr.onload = () =>
			finish(
				xhr.status >= 200 && xhr.status < 300
					? { ok: true }
					: { ok: false, error: { kind: 'rejected', status: xhr.status } }
			);
		xhr.onerror = () => finish({ ok: false, error: { kind: 'network' } });
		xhr.onabort = () => finish({ ok: false, error: { kind: 'aborted' } });

		signal?.addEventListener('abort', abort, { once: true });
		xhr.send(file);
	});
