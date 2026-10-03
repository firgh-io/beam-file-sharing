import { defineRelations } from "drizzle-orm";
import { check, int, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./helpers";

export const userTable = sqliteTable("user", {
  userId: int("user_id").primaryKey().default(1),
  usedByte: int("used_byte").notNull().default(0),
  createdAt: timestamps.createdAt,
});

export const quotaLedgerTable = sqliteTable("quota_ledger", {
  fileId: text("file_id").primaryKey(),
  bytes: int(),
  state: text().$type<"PENDING" | "COMMITTED">(),
  leaseUntil: text("lease_until"),
  updatedAt: timestamps.updatedAt,
});

export const relations = defineRelations({ userTable, quotaLedgerTable });
