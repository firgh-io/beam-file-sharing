import { decodeUnknownEffect, encodeUnknownEffect, Union } from "effect/Schema";
import {
  UploadRequest,
  UploadRequestQuotaExceeded,
  UploadRequestPayloadInvalid,
  UploadRequestRateLimited,
  UploadRequestInitialized,
  UploadCompleteSuccess,
  UploadCompleteFileNotFound,
  UploadCompleteFileSizeMismatch,
  UploadCompleteUnauthorizedFileAccess,
  UploadCompleteUploadNotVisible,
  UploadCompleteFileNotAccessible,
  DownloadRequestLimitExceeded,
  DownloadRequestFileExpired,
  DownloadRequestFileNotAvailable,
  DownloadRequestFileNotReady,
  DownloadRequestSuccess,
  DownloadRequestFileNotFound,
} from "./api-schema";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { Schema } from "effect";

export const decodeUploadRequest = decodeUnknownEffect(UploadRequest);
export const encodeUploadRequest = encodeUnknownEffect(UploadRequest);

const intializeUpload = HttpApiEndpoint.post("initializeUpload", "/v1/upload", {
  payload: UploadRequest,
  success: UploadRequestInitialized,
  error: Union([
    UploadRequestRateLimited,
    UploadRequestPayloadInvalid,
    UploadRequestQuotaExceeded,
  ]),
});

const completeUpload = HttpApiEndpoint.post(
  "completeUpload",
  "/v1/uploads/:fileId/complete",
  {
    params: Schema.Struct({
      fileId: Schema.String,
    }),
    success: UploadCompleteSuccess,
    error: Union([
      UploadCompleteFileNotFound,
      UploadCompleteFileSizeMismatch,
      UploadCompleteUnauthorizedFileAccess,
      UploadCompleteUploadNotVisible,
      UploadCompleteFileNotAccessible,
    ]),
  },
);

const downloadFile = HttpApiEndpoint.get(
  "downloadFile",
  "/v1/downloads/:fileId",
  {
    params: Schema.Struct({
      fileId: Schema.String,
    }),
    success: DownloadRequestSuccess,
    error: Union([
      DownloadRequestFileNotReady,
      DownloadRequestFileExpired,
      DownloadRequestLimitExceeded,
      DownloadRequestFileNotAvailable,
      DownloadRequestFileNotFound,
    ]),
  },
);

export class FileRequestGroup extends HttpApiGroup.make("FileRequests").add(
  intializeUpload,
  completeUpload,
  downloadFile,
) {}

export class FileRequestApi extends HttpApi.make("FileRequestApi").add(
  FileRequestGroup,
) {}
