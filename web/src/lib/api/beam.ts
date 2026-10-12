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
} from '../../../../backend/workers/api/api-schema';
import { post } from './http';

export type UploadBody = typeof UploadRequest.Encoded;
export type UploadOk = typeof UploadRequestInitialized.Encoded;
export type UploadError =
	| typeof UploadRequestPayloadInvalid.Encoded
	| typeof UploadRequestQuotaExceeded.Encoded
	| typeof UploadRequestRateLimited.Encoded;

export type CompleteOk = typeof UploadCompleteSuccess.Encoded;
export type CompleteError =
	| typeof UploadCompleteFileNotAccessible.Encoded
	| typeof UploadCompleteFileNotFound.Encoded
	| typeof UploadCompleteFileSizeMismatch.Encoded
	| typeof UploadCompleteUnauthorizedFileAccess.Encoded
	| typeof UploadCompleteUploadNotVisible.Encoded;

export const initializeUpload = (body: UploadBody, signal?: AbortSignal) =>
	post<UploadOk, UploadError>('/v1/upload', { body, signal });

export const completeUpload = (fileId: string, signal?: AbortSignal) =>
	post<CompleteOk, CompleteError>(`/v1/uploads/${fileId}/complete`, { signal });

// The response is the file stream, so callers navigate to this URL instead of fetching it.
export const downloadUrl = (fileId: string) => `/v1/downloads/${fileId}`;
