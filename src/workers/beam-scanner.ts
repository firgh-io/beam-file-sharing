import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { ScanQueue } from "../queue/scan-queue";
import type { QueueMessageBody } from "../queue/scan-queue";
import { Stream } from "effect";
import FileDO from "../durable-objects/file-do";
import { simulateMalwareScan } from "./scan-malware";

export default Cloudflare.Worker(
  "beam-scanner",
  { main: import.meta.url },
  Effect.gen(function* () {
    const queueResource = yield* ScanQueue;
    const fileDO = yield* FileDO;

    yield* Cloudflare.Queues.consumeQueueMessages<QueueMessageBody>(
      queueResource,
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

    return {
      fetch: Effect.succeed(HttpServerResponse.text("ok")),
    };
  }).pipe(Effect.provide([Cloudflare.Queues.EventSourceLive])),
);
