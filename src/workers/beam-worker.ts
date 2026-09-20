import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import {
  errorCode,
  MAX_EXPIRY_IN_DAYS,
  MAX_FILE_SIZE,
  USER_COOKIE_IDENTIFIER,
} from "../shared/constants";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { UploadRequestApi } from "./api/api";
import {
  UploadRequest,
  UploadRequestInvalidReason,
  UploadRequestPayloadInvalid,
  UploadRequestQuotaExceeded,
  UploadRequestRateLimited,
} from "./api/schema";
import * as DateTime from "effect/DateTime";
import UserDO from "../durable-objects/user";
import FileDO from "../durable-objects/file";
import { Layer, Option, Path } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { Etag, HttpPlatform } from "effect/unstable/http";
import type { NewFileInput } from "../durable-objects/file";

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

    const uploadRequestGroup = HttpApiBuilder.group(
      UploadRequestApi,
      "UploadRequests",
      (handlers) =>
        handlers.handle("initializeUpload", ({ payload, request }) =>
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
            });

            // TO DO:
            // - RETURN PRESIGNED URL
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
  }).pipe(Effect.provide(Cloudflare.Workers.RateLimitBinding)),
);
