import * as Cloudflare from "alchemy/Cloudflare";

export const FilesBucket = Cloudflare.R2.Bucket("FilesBucket", {
  cors: [
    {
      allowedMethods: ["PUT", "GET", "HEAD"],
      allowedHeaders: ["content-type", "content-length"],
      exposeHeaders: ["etag"],
      maxAgeSeconds: 3600,
      allowedOrigins: ["*"],
    },
  ],
});
