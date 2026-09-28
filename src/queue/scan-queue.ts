import * as Cloudflare from "alchemy/Cloudflare";

export const ScanQueue = Cloudflare.Queues.Queue("scanQueue");
