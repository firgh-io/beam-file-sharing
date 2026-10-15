import { decodeUnknownEffect, encodeUnknownEffect } from "effect/Schema";
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
  GetFileRequestSuccess,
  GetFileRequestFileNotFound,
} from "./api-schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Schema } from "effect";

export const decodeUploadRequest = decodeUnknownEffect(UploadRequest);
export const encodeUploadRequest = encodeUnknownEffect(UploadRequest);

const intializeUpload = HttpApiEndpoint.post("initializeUpload", "/v1/upload", {
  payload: UploadRequest,
  success: UploadRequestInitialized,
  error: [
    UploadRequestRateLimited,
    UploadRequestPayloadInvalid,
    UploadRequestQuotaExceeded,
  ],
});

const completeUpload = HttpApiEndpoint.post(
  "completeUpload",
  "/v1/uploads/:fileId/complete",
  {
    params: Schema.Struct({
      fileId: Schema.String,
    }),
    success: UploadCompleteSuccess,
    error: [
      UploadCompleteFileNotFound,
      UploadCompleteFileSizeMismatch,
      UploadCompleteUnauthorizedFileAccess,
      UploadCompleteUploadNotVisible,
      UploadCompleteFileNotAccessible,
    ],
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
    error: [
      DownloadRequestFileNotReady,
      DownloadRequestFileExpired,
      DownloadRequestLimitExceeded,
      DownloadRequestFileNotAvailable,
      DownloadRequestFileNotFound,
    ],
  },
);

const getFile = HttpApiEndpoint.get("getFile", "/v1/file/:fileId", {
  params: Schema.Struct({
    fileId: Schema.String,
  }),
  success: GetFileRequestSuccess,
  error: [GetFileRequestFileNotFound],
});

export class FileRequestGroup extends HttpApiGroup.make("FileRequests").add(
  intializeUpload,
  completeUpload,
  downloadFile,
  getFile,
) {}

export class FileRequestApi extends HttpApi.make("FileRequestApi").add(
  FileRequestGroup,
) {}
