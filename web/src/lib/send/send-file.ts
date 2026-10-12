import {
	completeUpload,
	initializeUpload,
	type CompleteError,
	type UploadError
} from '../api/beam';
import type { Aborted, ApiError } from '../api/http';
import { uploadToR2, type R2UploadError } from '../api/r2';
import { formatExpiryDate } from '../helper';
import { hashFile, type HashError } from './hash';

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

export type SendFailure = {
	[S in keyof StepErrors]: { ok: false; cancelled?: false; step: S; error: StepErrors[S] };
}[keyof StepErrors];

export type SendResult = { ok: true; link: string } | { ok: false; cancelled: true } | SendFailure;

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
