import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { fileTable, outboxTable, relations } from "./schema/file.schema";
import type {
  EffectSQLiteDoDatabase,
  EffectSQLiteDOTransaction,
} from "drizzle-orm/effect-sqlite-do";
import migrations from "../../drizzle/file/migrations";
import UserDO from "./user";
import { asc, eq } from "drizzle-orm";
import { Array, DateTime, Duration, Option } from "effect";
import {
  FILE_DO_ALARM_ID,
  LEASE_GRACE,
  LEASE_MARGIN,
  QUARANTINE_TTL,
  SCAN_TIMEOUT,
  URL_TTL,
} from "../shared/constants";
import { FilesBucket } from "../r2/files-bucket";
import { isNone } from "effect/Option";
import type { ReadWriteBucketClient } from "alchemy/Cloudflare/R2";

type Tx = EffectSQLiteDOTransaction<typeof relations>;
type Db = EffectSQLiteDoDatabase<typeof relations>;
type FileRow = typeof fileTable.$inferSelect;
type NewFile = typeof fileTable.$inferInsert;
type NewFileInput = Omit<
  typeof fileTable.$inferInsert,
  | "status"
  | "scanStatus"
  | "statusUpdatedAt"
  | "scanStatusUpdatedAt"
  | "createdAt"
>;
type FileStatus = NonNullable<FileRow["status"]>;
type FileRecord = Omit<
  FileRow,
  "expiresAt" | "createdAt" | "scanStatusUpdatedAt" | "statusUpdatedAt"
> & {
  expiresAt: DateTime.Utc;
  createdAt: DateTime.Utc;
  scanStatusUpdatedAt: DateTime.Utc;
  statusUpdatedAt: DateTime.Utc;
};

export default class FileDO extends Cloudflare.DurableObject<FileDO>()(
  "FileDO",
  Effect.gen(function* () {
    const dbInstance = yield* Drizzle.DurableObject({
      migrations,
      relations,
    });
    const state = yield* Cloudflare.DurableObjectState;
    const userDO = yield* UserDO;
    const filesBucket: ReadWriteBucketClient =
      yield* Cloudflare.R2.ReadWriteBucket(FilesBucket);

    const drainOutbox = Effect.gen(function* () {
      const rows = yield* dbInstance
        .select({
          outboxId: outboxTable.id,
          fileId: outboxTable.fileId,
          op: outboxTable.op,
          bytes: outboxTable.bytes,
          ownerId: fileTable.ownerId,
          expiresAt: fileTable.expiresAt,
        })
        .from(outboxTable)
        .innerJoin(fileTable, eq(outboxTable.fileId, fileTable.fileId));

      for (const row of rows) {
        if (row.ownerId !== null) {
          const owner = userDO.getByName(row.ownerId);
          switch (row.op) {
            case "COMMIT": {
              const leaseUntil = DateTime.addDuration(
                DateTime.makeUnsafe(row.expiresAt),
                LEASE_MARGIN,
              );
              yield* owner.commitFile(
                row.fileId,
                row.bytes,
                DateTime.formatIso(leaseUntil),
              );
              break;
            }
            case "RELEASE":
              yield* owner.releaseFile(row.fileId);
              break;
          }
        }

        yield* dbInstance
          .delete(outboxTable)
          .where(eq(outboxTable.id, row.outboxId));
      }
    });

    const getFileRow = (db: Db) =>
      Effect.map(Effect.head(db.select().from(fileTable).limit(1)), (row) => ({
        ...row,
        expiresAt: DateTime.makeUnsafe(row.expiresAt),
        createdAt: DateTime.makeUnsafe(row.createdAt),
        statusUpdatedAt: DateTime.makeUnsafe(row.statusUpdatedAt),
        scanStatusUpdatedAt: DateTime.makeUnsafe(row.scanStatusUpdatedAt),
      }));

    const retireFile = (
      db: Db,
      r2: ReadWriteBucketClient,
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

          // Delete the R2 Blob
          yield* r2.delete(file.fileBlobId);

          // Drain outbox
          yield* drainOutbox;
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

    const checkDeadline = (
      db: Db,
      r2: ReadWriteBucketClient,
      file: FileRecord,
      now: DateTime.Utc,
    ) =>
      Option.match(getOverdueStatus(file, now), {
        onNone: () => Effect.void,
        onSome: (overdueStatus) => retireFile(db, r2, file, overdueStatus, now),
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
        return Array.head(Array.sort(candidates, DateTime.Order));
      });

    return Effect.gen(function* () {
      return {
        initialize: (file: NewFileInput) =>
          dbInstance.transaction((tx) =>
            Effect.gen(function* () {
              const now = yield* DateTime.now;
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
                .onConflictDoNothing();
            }),
          ),
        alarm: () =>
          Effect.gen(function* () {
            const fired = yield* Cloudflare.Workers.processScheduledEvents;
            for (const event of fired) {
              if (event.id !== FILE_DO_ALARM_ID) return;
              // drain outbox
              yield* drainOutbox;
              // check deadlines
              const fileRow = yield* getFileRow(dbInstance);
              const now = yield* DateTime.now;

              yield* checkDeadline(dbInstance, filesBucket, fileRow, now);

              yield* scheduleNextWakeup(dbInstance, fileRow, now);
            }
          }),
      };
    });
  }).pipe(Effect.provide([Cloudflare.R2.ReadWriteBucketBinding])),
) {}
