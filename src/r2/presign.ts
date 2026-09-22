import { Effect, Redacted } from "effect";
import { FilesBucket } from "./files-bucket";
import * as Cloudflare from "alchemy/Cloudflare";
import { AwsClient } from "aws4fetch";

const sha256Hex = (input: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    ),
  );

const EXPIRY_QUERY_PARAM_KEY = "X-Amz-Expires";

export interface PresignInput {
  key: string;
  method: "PUT" | "GET";
  expiresIn: number;
  fileSize: number;
  fileType: string;
}

export const R2Presign = Effect.gen(function* () {
  const bucket = yield* FilesBucket;

  const token = yield* Cloudflare.ApiToken.AccountApiToken("r2-presign", {
    name: "r2PresignUrlToken",
    policies: [
      {
        effect: "allow",
        permissionGroups: ["Workers R2 Storage Bucket Item Write"],
        resources: { "com.cloudflare.edge.r2.bucket.*": "*" },
      },
    ],
  });

  const tokenId = yield* token.tokenId;
  const tokenValue = yield* token.value;
  const accountId = yield* token.accountId;
  const bucketName = yield* bucket.bucketName;

  const client = yield* Effect.cached(
    Effect.gen(function* () {
      const accessKeyId = yield* tokenId;
      const secretAccessKey = yield* sha256Hex(
        Redacted.value(yield* tokenValue),
      );
      return new AwsClient({
        accessKeyId,
        secretAccessKey,
        region: "auto",
        service: "s3",
      });
    }),
  );

  return (input: PresignInput) =>
    Effect.gen(function* () {
      const url = new URL(
        `https://${yield* accountId}.r2.cloudflarestorage.com/${yield* bucketName}/${input.key}`,
      );
      url.searchParams.set(EXPIRY_QUERY_PARAM_KEY, String(input.expiresIn));

      const awsClient = yield* client;
      const signed = yield* Effect.promise(() =>
        awsClient.sign(url, {
          method: input.method,
          aws: {
            signQuery: true,
            allHeaders: !!(input.fileSize || input.fileType),
          },
          headers: {
            ...(input.fileType ? { "Content-Type": input.fileType } : {}),
            ...(input.fileSize
              ? { "Content-Length": input.fileSize?.toString() }
              : {}),
          },
        }),
      );

      return signed.url;
    });
});
