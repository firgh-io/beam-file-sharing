import * as Cloudflare from "alchemy/Cloudflare";

export const FilesBucket = Cloudflare.R2.Bucket("FilesBucket");
