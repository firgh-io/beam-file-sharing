import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { fileTable, outboxTable, relations } from "./schema/file.schema";
import type {
  EffectSQLiteDoDatabase,
  EffectSQLiteDOTransaction,
} from "drizzle-orm/effect-sqlite-do";
import migrations from "../../drizzle/file/migrations";
import UserDO from "./user-do";
import { asc, eq, lt } from "drizzle-orm";
import {
  Array,
  Data,
  DateTime,
  Duration,
  Option,
  Result,
  Schedule,
} from "effect";
import {
  FILE_DO_ALARM_ID,
  LEASE_GRACE,
  LEASE_MARGIN,
  MAX_OUTBOX_DRAIN_ATTEMPT,
  QUARANTINE_TTL,
  SCAN_TIMEOUT,
  URL_TTL,
} from "../shared/constants";
import { FilesBucket } from "../r2/files-bucket";
import type { ReadWriteBucketClient } from "alchemy/Cloudflare/R2";
import type { ScanVerdict } from "../workers/scan-malware";
import type { TaggedError } from "effect/Schema";

type Tx = EffectSQLiteDOTransaction<typeof relations>;
type Db = EffectSQLiteDoDatabase<typeof relations>;
type FileRow = typeof fileTable.$inferSelect;
type NewOutbox = typeof outboxTable.$inferInsert;
type NewFile = typeof fileTable.$inferInsert;
export type NewFileInput = Omit<
  typeof fileTable.$inferInsert,
  | "status"
  | "scanStatus"
  | "statusUpdatedAt"
  | "scanStatusUpdatedAt"
  | "createdAt"
>;
type FileStatus = NonNullable<FileRow["status"]>;
type FileScanStatus = NonNullable<FileRow["scanStatus"]>;
type FileRecord = Omit<
  FileRow,
  "expiresAt" | "createdAt" | "scanStatusUpdatedAt" | "statusUpdatedAt"
> & {
  expiresAt: DateTime.Utc;
  createdAt: DateTime.Utc;
  scanStatusUpdatedAt: DateTime.Utc;
  statusUpdatedAt: DateTime.Utc;
};

export class ScanVerdictNotRecorded extends Data.TaggedError(
  "ScanVerdictNotRecorded",
)<{
  fileId: string;
}> {}

export default class FileDO extends Cloudflare.DurableObject<FileDO>()(
  "FileDO",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const userDO = yield* UserDO;
    const filesBucket: ReadWriteBucketClient =
      yield* Cloudflare.R2.ReadWriteBucket(FilesBucket);

    const drainOutbox = (db: Db, filesBucket: ReadWriteBucketClient) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            outboxId: outboxTable.id,
            fileId: outboxTable.fileId,
            op: outboxTable.op,
            bytes: outboxTable.bytes,
            ownerId: fileTable.ownerId,
            expiresAt: fileTable.expiresAt,
            fileBlobId: fileTable.fileBlobId,
            attempts: outboxTable.attempts,
            statusUpdatedAt: fileTable.statusUpdatedAt,
          })
          .from(outboxTable)
          .innerJoin(fileTable, eq(outboxTable.fileId, fileTable.fileId))
          .where(lt(outboxTable.attempts, MAX_OUTBOX_DRAIN_ATTEMPT))
          .orderBy(asc(outboxTable.id))
          .pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                ...row,
                attempts: row.attempts === null ? 0 : row.attempts,
              })),
            ),
          );

        const handleOp = (row: (typeof rows)[number]) =>
          Effect.gen(function* () {
            if (row.ownerId) {
              const owner = userDO.getByName(row.ownerId);
              switch (row.op) {
                case "COMMIT": {
                  const leaseUntil = DateTime.addDuration(
                    DateTime.makeUnsafe(row.expiresAt),
                    LEASE_MARGIN,
                  );
                  yield* owner.accountFileCommit(
                    row.fileId,
                    row.bytes,
                    DateTime.formatIso(leaseUntil),
                  );
                  break;
                }
                case "RELEASE":
                  yield* owner.accountFileRelease(row.fileId);
                  break;
                case "QUARANTINE": {
                  // update file in user DO
                  const quarantineTTL = DateTime.formatIso(
                    DateTime.addDuration(
                      DateTime.makeUnsafe(row.statusUpdatedAt),
                      Duration.sum(QUARANTINE_TTL, LEASE_MARGIN),
                    ),
                  );
                  yield* owner.updateLease(row.fileId, quarantineTTL);
                  // schedule Alarm
                }
              }
            }

            if (row.op === "RELEASE") {
              yield* filesBucket.delete(row.fileBlobId);
            }
          });

        const recordFailure = (row: (typeof rows)[number]) =>
          db
            .update(outboxTable)
            .set({
              attempts: row.attempts + 1,
            })
            .where(eq(outboxTable.id, row.outboxId));

        const acknowledge = (row: (typeof rows)[number]) =>
          db.delete(outboxTable).where(eq(outboxTable.id, row.outboxId));

        for (const row of rows) {
          const outcome = yield* Effect.result(
            handleOp(row).pipe(
              Effect.retry(
                Schedule.exponential("100 millis").pipe(
                  Schedule.upTo({ times: 2 }),
                ),
              ),
            ),
          );

          if (Result.isFailure(outcome)) {
            yield* recordFailure(row);
            const attempts = row.attempts + 1;

            if (attempts >= MAX_OUTBOX_DRAIN_ATTEMPT) {
              yield* Effect.logError("Outbox op parked after max attempts", {
                outBoxId: row.outboxId,
                fileId: row.fileId,
                op: row.op,
              });
              continue;
            }

            yield* Effect.logWarning("Outbox op failed, retrying later", {
              outboxId: row.outboxId,
              fileId: row.fileId,
              op: row.op,
              attempts,
              cause: outcome.failure,
            });

            break;
          }

          yield* acknowledge(row);
        }
      });

    const toFileRecord = (file: FileRow): FileRecord => {
      return {
        ...file,
        expiresAt: DateTime.makeUnsafe(file.expiresAt),
        createdAt: DateTime.makeUnsafe(file.createdAt),
        statusUpdatedAt: DateTime.makeUnsafe(file.statusUpdatedAt),
        scanStatusUpdatedAt: DateTime.makeUnsafe(file.scanStatusUpdatedAt),
      };
    };

    const getFileRow = (db: Db) =>
      Effect.map(
        Effect.head(db.select().from(fileTable).limit(1)),
        (row): FileRecord => toFileRecord(row),
      );

    const retireFile = (
      db: Db,
      file: FileRecord,
      newFileStatus: FileStatus,
      now: DateTime.Utc,
    ) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.update(fileTable).set({
            status: newFileStatus,
            statusUpdatedAt: DateTime.formatIso(now),
          });

          yield* tx.insert(outboxTable).values({
            fileId: file.fileId,
            op: "RELEASE",
            bytes: 0,
            createdAt: DateTime.formatIso(now),
          });
        }),
      );

    const getOverdueStatus = (
      file: FileRecord,
      now: DateTime.Utc,
    ): Option.Option<FileStatus> => {
      switch (file.status) {
        case "AWAITING_UPLOAD": {
          // Check if it has been longer than the URL_TTL +
          const pendingUploadFileDeadline = DateTime.addDuration(
            file.createdAt,
            Duration.sum(URL_TTL, LEASE_GRACE),
          );
          return DateTime.isLessThan(pendingUploadFileDeadline, now)
            ? Option.some("DELETED")
            : Option.none();
        }
        case "AVAILABLE": {
          return DateTime.isLessThan(file.expiresAt, now)
            ? Option.some("EXPIRED")
            : Option.none();
        }
        case "QUARANTINED": {
          const quarantineFileDeadline = DateTime.addDuration(
            file.statusUpdatedAt,
            QUARANTINE_TTL,
          );
          return DateTime.isLessThan(quarantineFileDeadline, now)
            ? Option.some("DELETED")
            : Option.none();
        }
        case "STORED": {
          return DateTime.isLessThan(
            DateTime.addDuration(file.statusUpdatedAt, SCAN_TIMEOUT),
            now,
          )
            ? Option.some("DELETED")
            : Option.none();
        }
        default:
          return Option.none();
      }
    };

    const checkDeadline = (db: Db, file: FileRecord, now: DateTime.Utc) =>
      Option.match(getOverdueStatus(file, now), {
        onNone: () => Effect.void,
        onSome: (overdueStatus) => retireFile(db, file, overdueStatus, now),
      });

    const getBackoff = (attempts: number) =>
      Duration.millis(Math.min(10_000 * 2 ** attempts, 60 * 60_000));

    const getLatestRetry = (db: Db, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const row = yield* db
          .select({
            attempts: outboxTable.attempts,
            createdAt: outboxTable.createdAt,
          })
          .from(outboxTable)
          .where(lt(outboxTable.attempts, MAX_OUTBOX_DRAIN_ATTEMPT))
          .orderBy(asc(outboxTable.id));

        return Array.head(row).pipe(
          Option.map((row) =>
            DateTime.addDuration(now, getBackoff(row.attempts ?? 0)),
          ),
        );
      });

    const getStatusExpiresAt = (
      file: FileRecord,
    ): Option.Option<DateTime.Utc> => {
      switch (file.status) {
        case "AWAITING_UPLOAD":
          return Option.some(
            DateTime.addDuration(
              file.createdAt,
              Duration.sum(URL_TTL, LEASE_GRACE),
            ),
          );
        case "AVAILABLE":
          return Option.some(file.expiresAt);
        case "QUARANTINED":
          return Option.some(
            DateTime.addDuration(file.statusUpdatedAt, QUARANTINE_TTL),
          );
        default:
          return Option.none();
      }
    };

    const scheduleNextWakeup = (db: Db, file: FileRecord, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const latestRetry = yield* getLatestRetry(db, now);
        const nextDeadline = getStatusExpiresAt(file);
        const candidates = Array.getSomes([latestRetry, nextDeadline]);
        const nextSchedule = Array.head(Array.sort(candidates, DateTime.Order));

        if (Option.isNone(nextSchedule)) return;

        yield* Cloudflare.Workers.scheduleEvent(
          FILE_DO_ALARM_ID,
          DateTime.toDate(nextSchedule.value),
          {},
        );
      });

    const setFileStatus = (
      db: Db,
      fileId: string,
      status: FileStatus,
      scanStatus: FileScanStatus,
      now: DateTime.Utc,
    ) => {
      const currentDateTime = DateTime.formatIso(now);
      return db
        .update(fileTable)
        .set({
          status,
          scanStatus,
          scanStatusUpdatedAt: currentDateTime,
          statusUpdatedAt: currentDateTime,
        })
        .where(eq(fileTable.fileId, fileId))
        .returning()
        .pipe(Effect.flatMap((rows) => Effect.fromNullishOr(rows.at(0))));
    };

    const commitFile = (
      db: Db,
      fileId: string,
      r2HeadSize: number,
      now: DateTime.Utc,
    ) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          const file = yield* setFileStatus(
            tx,
            fileId,
            "STORED",
            "PENDING",
            now,
          );

          yield* tx.insert(outboxTable).values({
            fileId: fileId,
            op: "COMMIT",
            bytes: r2HeadSize,
          });

          return file;
        }),
      );

    return Effect.gen(function* () {
      const dbInstance = yield* Drizzle.DurableObject({
        migrations,
        relations,
      });

      return {
        initialize: (file: NewFileInput) =>
          Effect.gen(function* () {
            const now = yield* DateTime.now;

            const fileRow = yield* dbInstance.transaction((tx) =>
              Effect.gen(function* () {
                const newFileInput: NewFile = {
                  ...file,
                  status: "AWAITING_UPLOAD",
                  statusUpdatedAt: DateTime.formatIso(now),
                  scanStatus: "PENDING",
                  scanStatusUpdatedAt: DateTime.formatIso(now),
                };

                yield* tx
                  .insert(fileTable)
                  .values(newFileInput)
                  .onConflictDoNothing()
                  .returning();

                return yield* getFileRow(tx);
              }),
            );

            yield* scheduleNextWakeup(dbInstance, fileRow, now);
          }).pipe(Effect.provideService(Cloudflare.DurableObjectState, state)),
        alarm: () =>
          Effect.gen(function* () {
            const fired = yield* Cloudflare.Workers.processScheduledEvents;
            for (const event of fired) {
              if (event.id !== FILE_DO_ALARM_ID) continue;
              // drain outbox
              yield* drainOutbox(dbInstance, filesBucket);
              // check deadlines
              const fileRow = yield* getFileRow(dbInstance);
              const now = yield* DateTime.now;

              yield* checkDeadline(dbInstance, fileRow, now);

              yield* scheduleNextWakeup(dbInstance, fileRow, now);
            }
          }),
        getFile: () =>
          Effect.gen(function* () {
            return yield* getFileRow(dbInstance);
          }),
        drainOutbox: () =>
          Effect.gen(function* () {
            return yield* drainOutbox(dbInstance, filesBucket);
          }),
        retireFile: (status: FileStatus) =>
          Effect.gen(function* () {
            const fileRow = yield* getFileRow(dbInstance);
            const now = yield* DateTime.now;
            return yield* retireFile(dbInstance, fileRow, status, now);
          }),
        commitFile: (fileId: string, r2HeadSize: number) =>
          Effect.gen(function* () {
            const now = yield* DateTime.now;
            const committedFile = toFileRecord(
              yield* commitFile(dbInstance, fileId, r2HeadSize, now),
            );
            yield* scheduleNextWakeup(dbInstance, committedFile, now);

            return committedFile;
          }).pipe(
            Effect.provideService(Cloudflare.DurableObjectState, state),
            Effect.catchTags({
              SqlError: Effect.die,
              EffectDrizzleQueryError: Effect.die,
            }),
          ),
        recordScanVerdict: (fileId: string, verdict: ScanVerdict) =>
          Effect.gen(function* () {
            const now = yield* DateTime.now;
            let filePostOp;
            switch (verdict) {
              case "MALICIOUS": {
                // set file status to malicious,
                filePostOp = yield* dbInstance.transaction((tx) =>
                  Effect.gen(function* () {
                    let file = yield* setFileStatus(
                      tx,
                      fileId,
                      "QUARANTINED",
                      "MALICIOUS",
                      now,
                    );

                    yield* tx.insert(outboxTable).values({
                      fileId,
                      op: "QUARANTINE",
                      bytes: 0,
                    });

                    return file;
                  }),
                );
                break;
              }
              case "CLEAN": {
                filePostOp = yield* setFileStatus(
                  dbInstance,
                  fileId,
                  "AVAILABLE",
                  "CLEAN",
                  now,
                );
              }
            }
            const fileRecord = toFileRecord(filePostOp);
            yield* scheduleNextWakeup(dbInstance, fileRecord, now);
          }).pipe(
            Effect.provideService(Cloudflare.DurableObjectState, state),
            Effect.catchTags({
              SqlError: () => new ScanVerdictNotRecorded({ fileId }),
              EffectDrizzleQueryError: () =>
                new ScanVerdictNotRecorded({ fileId }),
            }),
          ),
      };
    });
  }).pipe(Effect.provide([Cloudflare.R2.ReadWriteBucketBinding])),
) {}
