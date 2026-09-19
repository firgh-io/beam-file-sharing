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
import { MAX_EXPIRY_IN_DAYS } from "../../shared/constants";

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
