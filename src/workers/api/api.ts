import {
  Struct,
  decodeUnknownEffect,
  encodeUnknownEffect,
  String,
  Union,
} from "effect/Schema";
import {
  UploadRequest,
  UploadRequestQuotaExceeded,
  UploadRequestPayloadInvalid,
  UploadRequestRateLimited,
} from "./schema";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";

export const decodeUploadRequest = decodeUnknownEffect(UploadRequest);
export const encodeUploadRequest = encodeUnknownEffect(UploadRequest);

const intializeUpload = HttpApiEndpoint.post("initializeUpload", "/v1/upload", {
  payload: UploadRequest,
  error: Union([
    UploadRequestRateLimited,
    UploadRequestPayloadInvalid,
    UploadRequestQuotaExceeded,
  ]),
});

export class UploadRequestGroup extends HttpApiGroup.make("UploadRequests").add(
  intializeUpload,
) {}

export class UploadRequestApi extends HttpApi.make("UploadRequestApi").add(
  UploadRequestGroup,
) {}
