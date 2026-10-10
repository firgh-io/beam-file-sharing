import type {
	UploadRequest,
	UploadRequestInitialized,
	UploadRequestPayloadInvalid,
	UploadRequestQuotaExceeded,
	UploadRequestRateLimited,
	UploadCompleteSuccess,
	UploadCompleteFileNotAccessible,
	UploadCompleteFileNotFound,
	UploadCompleteFileSizeMismatch,
	UploadCompleteUnauthorizedFileAccess,
	UploadCompleteUploadNotVisible
} from '../../../backend/workers/api/api-schema';
import { calculateFileSHA256, formatExpiryDate } from './helper';

type UploadBody = typeof UploadRequest.Encoded;
type UploadOk = typeof UploadRequestInitialized.Encoded;
type UploadError =
	| typeof UploadRequestPayloadInvalid.Encoded
	| typeof UploadRequestQuotaExceeded.Encoded
	| typeof UploadRequestRateLimited.Encoded;

type CompleteOk = typeof UploadCompleteSuccess.Encoded;
type CompleteError =
	| typeof UploadCompleteFileNotAccessible.Encoded
	| typeof UploadCompleteFileNotFound.Encoded
	| typeof UploadCompleteFileSizeMismatch.Encoded
	| typeof UploadCompleteUnauthorizedFileAccess.Encoded
	| typeof UploadCompleteUploadNotVisible.Encoded;

type Aborted = { kind: 'aborted' };
type ApiError<Err> = { kind: 'network' } | { kind: 'rejected'; status: number; body?: Err };
type ApiResult<Ok, Err> = { ok: true; data: Ok } | { ok: false; error: ApiError<Err> | Aborted };

type R2UploadError = { kind: 'network' } | { kind: 'rejected'; status: number };
type R2UploadResult = { ok: true } | { ok: false; error: R2UploadError | Aborted };

type HashError = { kind: 'unreadable' } | { kind: 'unsupported' };
type HashResult = { ok: true; data: string } | { ok: false; error: HashError };

export const Step = {
	Hashing: 'hashing',
	Initializing: 'initializing',
	Uploading: 'uploading',
	Completing: 'completing'
} as const;
export type SendStep = (typeof Step)[keyof typeof Step];
export type SendEvent = { step: SendStep; loaded?: number; total?: number };

type StepErrors = {
	[Step.Hashing]: HashError;
	[Step.Initializing]: ApiError<UploadError>;
	[Step.Uploading]: R2UploadError;
	[Step.Completing]: ApiError<CompleteError>;
};

type SendFailure = {
	[S in keyof StepErrors]: { ok: false; cancelled?: false; step: S; error: StepErrors[S] };
}[keyof StepErrors];

export type SendResult = { ok: true; link: string } | { ok: false; cancelled: true } | SendFailure;

const post = async <Ok, Err>(
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

const initializeUpload = (body: UploadBody, signal?: AbortSignal) =>
	post<UploadOk, UploadError>('/v1/upload', { body, signal });

const completeUpload = (fileId: string, signal?: AbortSignal) =>
	post<CompleteOk, CompleteError>(`/v1/uploads/${fileId}/complete`, { signal });

const hashFile = async (file: File): Promise<HashResult> => {
	// crypto.subtle only exists in secure contexts (https or localhost)
	if (!globalThis.crypto?.subtle) return { ok: false, error: { kind: 'unsupported' } };

	try {
		return { ok: true, data: await calculateFileSHA256(file) };
	} catch {
		return { ok: false, error: { kind: 'unreadable' } };
	}
};

// XHR instead of fetch: fetch has no upload progress events
const uploadToR2 = (
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

const cancelled: SendResult = { ok: false, cancelled: true };

export const sendFile = async (
	file: File,
	opts: { maxDownloadCount?: number; expiresOn?: string },
	onEvent: (e: SendEvent) => void,
	signal?: AbortSignal
): Promise<SendResult> => {
	const fail = <S extends keyof StepErrors>(step: S, error: StepErrors[S] | Aborted): SendResult =>
		signal?.aborted || error.kind === 'aborted'
			? cancelled
			: ({ ok: false, step, error } as SendFailure);

	onEvent({ step: Step.Hashing });
	const hashed = await hashFile(file);
	if (!hashed.ok) return fail(Step.Hashing, hashed.error);
	if (signal?.aborted) return cancelled;

	// Browsers report '' for unknown extensions. The same value is signed into the upload URL.
	const fileType = file.type || 'application/octet-stream';

	onEvent({ step: Step.Initializing });
	const initialized = await initializeUpload(
		{
			fileName: file.name,
			fileSize: file.size,
			fileType,
			fileSha256: hashed.data,
			maxDownloadCount: opts.maxDownloadCount,
			expiresAt: opts.expiresOn ? formatExpiryDate(opts.expiresOn) : undefined
		},
		signal
	);
	if (!initialized.ok) return fail(Step.Initializing, initialized.error);

	onEvent({ step: Step.Uploading });
	const uploaded = await uploadToR2(
		initialized.data.uploadUrl,
		file,
		fileType,
		(loaded, total) => onEvent({ step: Step.Uploading, loaded, total }),
		signal
	);
	if (!uploaded.ok) return fail(Step.Uploading, uploaded.error);

	onEvent({ step: Step.Completing });
	const completed = await completeUpload(initialized.data.fileId, signal);
	if (!completed.ok) return fail(Step.Completing, completed.error);

	return { ok: true, link: completed.data.sharableLink };
};
