import { Effect } from "effect";
import { FilesBucket } from "./files-bucket";
import * as Cloudflare from "alchemy/Cloudflare";
import { AwsClient } from "aws4fetch";

const EXPIRY_QUERY_PARAM_KEY = "X-Amz-Expires";

export interface PresignInput {
  key: string;
  method: "PUT" | "GET";
  expiresIn: number;
  fileSize: number;
  fileType: string;
}

export const R2Presign = Effect.gen(function* () {
  const credentials = yield* Cloudflare.R2.S3Credentials(FilesBucket, {
    access: "write",
  });

  return (input: PresignInput) =>
    Effect.gen(function* () {
      const { endpoint, bucketName, region, accessKeyId, secretAccessKey } =
        yield* credentials;
      const awsClient = new AwsClient({
        accessKeyId,
        secretAccessKey,
        region,
        service: "s3",
      });

      const url = new URL(
        `${endpoint}/${encodeURIComponent(bucketName)}/${input.key}`,
      );
      url.searchParams.set(EXPIRY_QUERY_PARAM_KEY, String(input.expiresIn));

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
