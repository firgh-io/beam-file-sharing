import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import {
  String,
  Number,
  Class,
  TaggedError,
  optional,
  DateTimeUtcFromString,
  withDecodingDefaultType,
  Literals,
} from "effect/Schema";
import {
  MAX_EXPIRY_IN_DAYS,
  USER_COOKIE_IDENTIFIER,
  FILE_STATUSES,
} from "../../shared/constants";
import { HttpApiSchema } from "effect/http-api";

/* ----------------------  UPLOAD -------------------------------------- */
export class UploadRequest extends Class<UploadRequest>("UploadRequest")({
  fileName: String,
  fileSize: Number,
  fileSha256: String,
  fileType: String,
  expiresAt: DateTimeUtcFromString.pipe(
    withDecodingDefaultType(
      Effect.map(DateTime.now, DateTime.add({ days: MAX_EXPIRY_IN_DAYS })),
    ),
  ),
  webhookUrl: optional(String),
  maxDownloadCount: optional(Number),
}) {}

export class UploadRequestInitialized extends Class<UploadRequestInitialized>(
  "UploadRequestInitialized",
)({
  fileId: String,
  uploadUrl: String,
}) {}
export class UploadRequestRateLimited extends TaggedError<UploadRequestRateLimited>()(
  "UploadRequestRateLimited",
  { id: String },
  { httpApiStatus: 429 },
) {}

export const UploadRequestInvalidReason = Literals([
  "INVALID_WEBHOOK_URL",
  "INVALID_EXPIRY_DATE",
  "INVALID_MAX_DOWNLOAD_COUNT",
  "INVALID_FILE_SIZE",
  "INVALID_FILE_TYPE",
]);

export class UploadRequestPayloadInvalid extends TaggedError<UploadRequestPayloadInvalid>()(
  "UploadRequestPayloadInvalid",
  { id: String, reason: UploadRequestInvalidReason, message: String },
  { httpApiStatus: 400 },
) {}

export class UploadRequestQuotaExceeded extends TaggedError<UploadRequestQuotaExceeded>()(
  "UploadRequestQuotaExceeded",
  { id: String, usedBytes: Number, requestedBytes: Number, limitBytes: Number },
  { httpApiStatus: 413 },
) {}

/* ----------------------  COMPLETE -------------------------------------- */

export class UploadCompleteSuccess extends Class<UploadCompleteSuccess>(
  "UploadCompleteSuccess",
)(
  {
    sharableLink: String,
  },
  { httpApiStatus: 200 },
) {}

export class UploadCompleteUnauthorizedFileAccess extends TaggedError<UploadCompleteUnauthorizedFileAccess>()(
  "UploadCompleteUnauthorizedFileAccess",
  { id: String },
  { httpApiStatus: 401 },
) {}

export class UploadCompleteFileNotAccessible extends TaggedError<UploadCompleteFileNotAccessible>()(
  "UploadCompleteFileNotAccessible",
  { id: String },
  { httpApiStatus: 410 },
) {}
export class UploadCompleteFileNotFound extends TaggedError<UploadCompleteFileNotFound>()(
  "UploadCompleteFileNotFound",
  { id: String },
  { httpApiStatus: 404 },
) {}

export class UploadCompleteFileSizeMismatch extends TaggedError<UploadCompleteFileSizeMismatch>()(
  "UploadCompleteFileSizeMismatch",
  { id: String },
  { httpApiStatus: 400 },
) {}

export class UploadCompleteUploadNotVisible extends TaggedError<UploadCompleteUploadNotVisible>()(
  "UploadCompleteUploadNotVisible",
  { id: String },
  { httpApiStatus: 409 },
) {}

/* ----------------------  Download -------------------------------------- */

// TODO: Download request success returns file stream
export const DownloadRequestSuccess = HttpApiSchema.StreamUint8Array({
  contentType: "application/octet-stream",
});

export class DownloadRequestFileNotReady extends TaggedError<DownloadRequestFileNotReady>()(
  "DownloadRequestFileNotReady",
  { id: String },
  { httpApiStatus: 403 },
) {}

export class DownloadRequestFileExpired extends TaggedError<DownloadRequestFileExpired>()(
  "DownloadRequestFileExpired",
  { id: String },
  { httpApiStatus: 403 },
) {}

export class DownloadRequestLimitExceeded extends TaggedError<DownloadRequestLimitExceeded>()(
  "DownloadRequestLimitExceeded",
  { id: String, limit: Number },
  { httpApiStatus: 403 },
) {}

export class DownloadRequestFileNotAvailable extends TaggedError<DownloadRequestFileNotAvailable>()(
  "DownloadRequestFileNotAvailable",
  { id: String },
  { httpApiStatus: 403 },
) {}

export class DownloadRequestFileNotFound extends TaggedError<DownloadRequestFileNotFound>()(
  "DownloadRequestFileNotFound",
  { id: String },
  { httpApiStatus: 404 },
) {}

/* ---------------------- Get File Metadata -------------------------------- */

export class GetFileRequestSuccess extends Class<GetFileRequestSuccess>(
  "GetFileRequestSuccess",
)(
  {
    fileName: String,
    fileSize: Number,
    fileType: String,
    expiresAt: String,
    maxDownloadCount: optional(Number),
    downloadsLeft: optional(Number),
    status: Literals(FILE_STATUSES),
  },
  { httpApiStatus: 200 },
) {}

export class GetFileRequestFileNotFound extends TaggedError<GetFileRequestFileNotFound>()(
  "GetFileRequestFileNotFound",
  { id: String },
  { httpApiStatus: 404 },
) {}
