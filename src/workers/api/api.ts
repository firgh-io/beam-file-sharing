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
} from "./api-schema";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
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

export class UploadRequestGroup extends HttpApiGroup.make("UploadRequests").add(
  intializeUpload,
  completeUpload,
) {}

export class UploadRequestApi extends HttpApi.make("UploadRequestApi").add(
  UploadRequestGroup,
) {}
