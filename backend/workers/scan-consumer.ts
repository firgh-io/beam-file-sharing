import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { Stream } from "effect";
import type { ScanQueue, QueueMessageBody } from "../queue/scan-queue";
import type FileDO from "../durable-objects/file-do";
import { simulateMalwareScan } from "./scan-malware";

export const consumeScanQueue = (
  queue: Effect.Success<typeof ScanQueue>,
  fileDO: Effect.Success<typeof FileDO>,
) =>
  Cloudflare.Queues.consumeQueueMessages<QueueMessageBody>(
    queue,
    {
      batchSize: 1,
      maxRetries: 3,
    },
    (stream) =>
      Stream.runForEach(stream, (msg) =>
        Effect.gen(function* () {
          const { body } = msg;
          const existingFileDO = fileDO.getByName(body.fileId);
          const file = yield* existingFileDO.getFile();

          const isPendingOrError =
            file.scanStatus === "PENDING" || file.scanStatus === "ERROR";

          if (!isPendingOrError || file.status !== "STORED") return;

          const scanResult = yield* simulateMalwareScan(
            file.fileId,
            msg.attempts,
          );

          yield* existingFileDO.recordScanVerdict(file.fileId, scanResult);
        }).pipe(
          Effect.catchTags({
            ScanFailed: (e) =>
              Effect.sync(() => {
                console.error(
                  `scan failed: ${e.fileId} at attempt ${e.attempt}`,
                );
                msg.retry();
              }),
            ScanVerdictNotRecorded: (e) =>
              Effect.sync(() => {
                console.error(
                  `Failed to record scan result for file ${e.fileId} at attempt ${msg.attempts}`,
                );
                msg.retry();
              }),
          }),
        ),
      ),
  );
