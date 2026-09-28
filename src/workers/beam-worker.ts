import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import {
  errorCode,
  LEASE_GRACE,
  MAX_EXPIRY_IN_DAYS,
  MAX_FILE_SIZE,
  URL_TTL,
  USER_COOKIE_IDENTIFIER,
} from "../shared/constants";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { UploadRequestApi } from "./api/api";
import {
  UploadCompleteFileNotAccessible,
  UploadCompleteFileNotFound,
  UploadCompleteFileSizeMismatch,
  UploadCompleteSuccess,
  UploadCompleteUnauthorizedFileAccess,
  UploadRequest,
  UploadRequestInitialized,
  UploadRequestInvalidReason,
  UploadRequestPayloadInvalid,
  UploadRequestQuotaExceeded,
  UploadRequestRateLimited,
} from "./api/api-schema";
import * as DateTime from "effect/DateTime";
import UserDO from "../durable-objects/user-do";
import FileDO from "../durable-objects/file-do";
import { Duration, Layer, Option, Path, Schedule } from "effect";
import {
  Etag,
  HttpEffect,
  HttpPlatform,
  HttpServerResponse,
  HttpRouter,
} from "effect/unstable/http";
import { R2Presign } from "../r2/presign";
import { FilesBucket } from "../r2/files-bucket";
import { ScanQueue } from "../queue/scan-queue";

type Reason = typeof UploadRequestInvalidReason.Type;
type Rule = readonly [
  reason: Reason,
  valid: (p: UploadRequest, now: DateTime.Utc) => boolean,
];

const rules: readonly Rule[] = [
  ["INVALID_FILE_SIZE", (p) => isSizeValid(p.fileSize)],
  ["INVALID_EXPIRY_DATE", (p, now) => isExpiryDateValid(p.expiresAt, now)],
  [
    "INVALID_MAX_DOWNLOAD_COUNT",
    (p) => isMaxDownloadCountValid(p.maxDownloadCount),
  ],
  ["INVALID_WEBHOOK_URL", (p) => isValidWebhookUrl(p.webhookUrl)],
];

const isExpiryDateValid = (expiresAt: DateTime.Utc, now: DateTime.Utc) => {
  const max: DateTime.Utc = DateTime.add(now, {
    days: MAX_EXPIRY_IN_DAYS,
  });
  return DateTime.between(expiresAt, { minimum: now, maximum: max });
};

const isMaxDownloadCountValid = (maxDownloadCount: number | undefined) =>
  maxDownloadCount === undefined || Number(maxDownloadCount) > 0;

const isSizeValid = (fileSize: number) =>
  fileSize > 0 && fileSize <= MAX_FILE_SIZE;

export function isValidWebhookUrl(
  input: string | undefined,
  allowedHosts?: string[],
): boolean {
  if (input === undefined) return true;

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;

  const host = url.hostname.replace(/\.$/, "");
  if (!host.includes(".")) return false;

  if (allowedHosts) {
    return allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
  }
  return true;
}

const invalidReason = (payload: UploadRequest, now: DateTime.Utc) =>
  Option.fromUndefinedOr(rules.find(([, valid]) => !valid(payload, now))?.[0]);

const HttpPlatformStub = Layer.succeed(HttpPlatform.HttpPlatform, {
  platform: "web",
  compression: {
    algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
    compressResponse: (response) => Effect.succeed(response),
  },
  fileResponse: () => Effect.die("HttpPlatform.fileResponse not supported"),
  fileWebResponse: () =>
    Effect.die("HttpPlatform.fileWebResponse not supported"),
});

export default Cloudflare.Worker(
  "Beam",
  { main: import.meta.url },
  Effect.gen(function* () {
    const throttle = yield* Cloudflare.RateLimit("IPLIMIT", {
      namespaceId: 1000,
      simple: { limit: 20, period: 60 },
    });
    const userDO = yield* UserDO;
    const fileDO = yield* FileDO;
    const presign = yield* R2Presign;
    const filesBucket = yield* Cloudflare.R2.ReadBucket(FilesBucket);
    const queueResource = yield* ScanQueue;
    const scanQueue = yield* Cloudflare.Queues.WriteQueue(queueResource);

    const uploadRequestGroup = HttpApiBuilder.group(
      UploadRequestApi,
      "UploadRequests",
      (handlers) =>
        handlers
          .handle("initializeUpload", ({ payload, request }) =>
            Effect.gen(function* () {
              // Check Rate Limit
              const { headers, cookies } = request;
              const ip = headers["cf-connecting-ip"] ?? "unkown";

              const { success } = yield* throttle
                .limit({ key: ip })
                .pipe(Effect.orDie);

              if (!success) {
                return yield* Effect.fail(
                  new UploadRequestRateLimited({
                    id: errorCode.tooManyRequests,
                  }),
                );
              }

              const now = yield* DateTime.now;

              /* Validate Input */
              const reason = invalidReason(payload, now);
              if (Option.isSome(reason)) {
                return yield* new UploadRequestPayloadInvalid({
                  id: errorCode.payloadInvalid,
                  reason: reason.value,
                  message: `Validation failed: ${reason.value}`,
                });
              }

              /* Identify User ID based on Cookie */
              const userId =
                cookies[USER_COOKIE_IDENTIFIER] || crypto.randomUUID();

              yield* HttpEffect.appendPreResponseHandler((_req, response) =>
                Effect.orDie(
                  HttpServerResponse.setCookie(
                    response,
                    USER_COOKIE_IDENTIFIER,
                    userId,
                    {
                      httpOnly: true,
                      secure: true,
                      sameSite: "lax",
                      path: "/",
                      maxAge: Duration.days(365),
                    },
                  ),
                ),
              );

              /* Generate File ID */
              const fileId = crypto.randomUUID();
              const fileBlobId = crypto.randomUUID();

              /* Call user operation */
              yield* userDO
                .getByName(userId)
                .record(fileId, payload.fileSize)
                .pipe(
                  Effect.catchTag(
                    "UploadRequestQuotaExceeded",
                    (e) => new UploadRequestQuotaExceeded(e),
                  ),
                );

              yield* fileDO.getByName(fileId).initialize({
                fileId,
                fileBlobId,
                fileName: payload.fileName,
                expiresAt: DateTime.formatIso(payload.expiresAt),
                fileSize: payload.fileSize,
                fileType: payload.fileType,
                maxDownloadCount: payload.maxDownloadCount,
                ownerId: userId,
              });

              // TO DO:
              // - RETURN PRESIGNED URL
              const presignUrlTTL = Duration.toSeconds(
                Duration.sum(URL_TTL, LEASE_GRACE),
              );
              const uploadUrl = yield* presign({
                key: fileBlobId,
                method: "PUT",
                expiresIn: presignUrlTTL,
                fileSize: payload.fileSize,
                fileType: payload.fileType,
              });

              return new UploadRequestInitialized({
                fileId,
                uploadUrl,
              });
            }),
          )
          .handle("completeUpload", ({ request, params }) =>
            Effect.gen(function* () {
              // get cookie. Make sure it matches the file DO's
              const { cookies } = request;
              const userId = cookies[USER_COOKIE_IDENTIFIER];
              const existingFileDO = fileDO.getByName(params.fileId);
              const now = yield* DateTime.now;
              const file = yield* existingFileDO.getFile().pipe(
                Effect.catchTags({
                  EffectDrizzleQueryError: Effect.die,
                  NoSuchElementError: () =>
                    new UploadCompleteFileNotFound({
                      id: errorCode.fileNotFound,
                    }),
                }),
              );

              // Ensure that the requester actually is the file owner
              if (file.ownerId !== userId) {
                return yield* new UploadCompleteUnauthorizedFileAccess({
                  id: errorCode.unauthorizedFileAccess,
                });
              }

              // TO DO: make this an actual link
              const sharableLink = `https://website.com/files/${file.fileId}`;

              switch (file.status) {
                case "STORED":
                case "AVAILABLE": {
                  yield* existingFileDO
                    .drainOutbox()
                    .pipe(
                      Effect.catchTag("EffectDrizzleQueryError", Effect.die),
                    );
                  return new UploadCompleteSuccess({
                    sharableLink,
                  });
                }
                case "DELETED":
                case "EXPIRED":
                case "QUARANTINED": {
                  return yield* new UploadCompleteFileNotAccessible({
                    id: errorCode.fileNotAccessible,
                  });
                }
                case "AWAITING_UPLOAD": {
                  // TO DO:

                  // HEAD R2 and perform actions
                  const fileObject = yield* filesBucket
                    .head(file.fileBlobId)
                    .pipe(Effect.catchTag("R2Error", Effect.die));

                  if (!fileObject) {
                    // TO DO: differentiate file not found vs file is still not showing in R2 yet (read vs write race condition issue)
                    return yield* new UploadCompleteFileNotFound({
                      id: errorCode.fileNotFound,
                    });
                  }

                  // File size mismatches. What's uploaded to R2 differs to what the user claim.
                  if (fileObject?.size !== file.fileSize) {
                    return yield* new UploadCompleteFileSizeMismatch({
                      id: errorCode.fileSizeMismatch,
                    });
                  }

                  // push to outbox to commit if previous step went well
                  const committedFile = yield* existingFileDO
                    .commitFile(file.fileId, fileObject.size)
                    .pipe(
                      Effect.catchTags({
                        NoSuchElementError: () =>
                          new UploadCompleteFileNotFound({
                            id: errorCode.fileNotFound,
                          }),
                      }),
                    );

                  // Queue file for scanning
                  yield* scanQueue
                    .send({
                      fileId: file.fileId,
                      fileBlobId: file.fileBlobId,
                    })
                    .pipe(
                      Effect.retry(
                        Schedule.exponential("100 millis").pipe(
                          Schedule.upTo({ times: 3 }),
                        ),
                      ),
                      Effect.catchTag("SendError", Effect.die),
                    );

                  // return sharable url
                  return new UploadCompleteSuccess({
                    sharableLink,
                  });
                }
              }
            }),
          ),
    );

    return {
      fetch: yield* HttpRouter.toHttpEffect(
        HttpApiBuilder.layer(UploadRequestApi).pipe(
          Layer.provide(uploadRequestGroup),
          Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
          Layer.provide(
            HttpRouter.cors({
              allowedOrigins: ["*"],
              allowedMethods: ["GET", "POST", "OPTIONS"],
            }),
          ),
        ),
      ),
    };
  }).pipe(
    Effect.provide([
      Cloudflare.Workers.RateLimitBinding,
      Cloudflare.R2.ReadBucketBinding,
      Cloudflare.Queues.WriteQueueBinding,
    ]),
  ),
);
