import * as Cloudflare from "alchemy/Cloudflare";

export interface QueueMessageBody {
  fileId: string;
  fileBlobId: string;
  sentAt: string;
}

export const ScanQueue = Cloudflare.Queues.Queue("scanQueue");
