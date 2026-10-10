import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { userTable, relations, quotaLedgerTable } from "./schema/user.schema";
import migrations from "../../drizzle/user/migrations";
import type { EffectSQLiteDOTransaction } from "drizzle-orm/effect-sqlite-do";
import { lt, eq, sql } from "drizzle-orm";
import { DateTime, Duration } from "effect";
import {
  errorCode,
  LEASE_GRACE,
  URL_TTL,
  USER_QUOTA_BYTES,
} from "../shared/constants";
import { UserDO } from "./user-do";
import { UploadRequestQuotaExceeded } from "../workers/api/api-schema";

type Tx = EffectSQLiteDOTransaction<typeof relations>;

const userDOImpl = Effect.gen(function* () {
  return Effect.gen(function* () {
    const db = yield* Drizzle.DurableObject({
      migrations,
      relations,
    });

    const pruneLedger = (tx: Tx, now: DateTime.Utc) =>
      tx
        .delete(quotaLedgerTable)
        .where(lt(quotaLedgerTable.leaseUntil, DateTime.formatIso(now)));

    const calculateUsedBytes = (tx: Tx) =>
      Effect.map(
        tx
          .select({
            value: sql<number>`coalesce(sum(${quotaLedgerTable.bytes}), 0)`,
          })
          .from(quotaLedgerTable),
        (rows) => rows[0]?.value ?? 0,
      );

    const insertLedgerEntry = (
      tx: Tx,
      fileId: string,
      fileSize: number,
      leaseUntil: DateTime.Utc,
    ) =>
      Effect.map(
        tx
          .insert(quotaLedgerTable)
          .values({
            fileId,
            bytes: fileSize,
            state: "PENDING",
            leaseUntil: DateTime.formatIso(leaseUntil),
          })
          .onConflictDoNothing()
          .returning({
            fileId: quotaLedgerTable.fileId,
            bytes: quotaLedgerTable.bytes,
            leaseUntil: quotaLedgerTable.leaseUntil,
          }),
        (rows) => rows[0],
      );

    const findLedgerEntry = (tx: Tx, fileId: string) =>
      tx.query.quotaLedgerTable.findFirst({ where: { fileId } });

    return {
      getUser: () => db.query.userTable.findFirst(),
      createUser: () =>
        db.insert(userTable).values({ userId: 1 }).onConflictDoNothing(),
      record: (fileId: string, fileSize: number) =>
        db
          .transaction((tx: Tx) =>
            Effect.gen(function* () {
              const now = yield* DateTime.now;
              const leaseUntil = DateTime.addDuration(
                now,
                Duration.sum(URL_TTL, LEASE_GRACE),
              );
              yield* pruneLedger(tx, now);

              const usedBytes = yield* calculateUsedBytes(tx);
              const requestedBytes = usedBytes + fileSize;

              if (requestedBytes > USER_QUOTA_BYTES) {
                return yield* new UploadRequestQuotaExceeded({
                  id: errorCode.quotaExceeded,
                  usedBytes,
                  requestedBytes,
                  limitBytes: USER_QUOTA_BYTES,
                });
              }

              const inserted =
                (yield* insertLedgerEntry(tx, fileId, fileSize, leaseUntil)) ??
                (yield* findLedgerEntry(tx, fileId));

              return {
                leaseUntil:
                  inserted?.leaseUntil ?? DateTime.formatIso(leaseUntil),
                usedBytes: requestedBytes,
              };
            }),
          )
          .pipe(
            Effect.catchTags({
              EffectDrizzleQueryError: Effect.die,
              SqlError: Effect.die,
            }),
          ),
      accountFileCommit: (
        fileId: string,
        fileSize: number,
        leaseUntil: string,
      ) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          return yield* db
            .insert(quotaLedgerTable)
            .values({
              fileId,
              bytes: fileSize,
              state: "COMMITTED",
              leaseUntil,
              updatedAt: DateTime.formatIso(now),
            })
            .onConflictDoUpdate({
              target: quotaLedgerTable.fileId,
              set: {
                bytes: fileSize,
                state: "COMMITTED",
                leaseUntil,
                updatedAt: DateTime.formatIso(now),
              },
            })
            .returning()
            .pipe(Effect.map((rows) => rows[0]));
        }),
      accountFileRelease: (fileId: string) =>
        Effect.gen(function* () {
          return yield* db
            .delete(quotaLedgerTable)
            .where(eq(quotaLedgerTable.fileId, fileId))
            .returning()
            .pipe(Effect.map((rows) => rows[0]));
        }),
      updateLease: (fileId: string, leaseUntil: string) =>
        Effect.gen(function* () {
          return yield* db
            .update(quotaLedgerTable)
            .set({
              leaseUntil,
            })
            .where(eq(quotaLedgerTable.fileId, fileId));
        }),
    };
  });
});

export type UserDOShape = Effect.Success<Effect.Success<typeof userDOImpl>>;

export const UserDOLive = UserDO.make(userDOImpl);
