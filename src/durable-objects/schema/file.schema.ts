import { defineRelations } from "drizzle-orm";
import {
  check,
  int,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { timestamps } from "./helpers";

export const fileTable = sqliteTable("file", {
  fileId: text("file_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  fileBlobId: text("file_blob_id").notNull(),
  fileName: text("file_name"),
  fileType: text("file_type"),
  fileSize: int("file_size"),
  fileSha256: text("file_sha256"),
  status: text()
    .$type<
      | `AWAITING_UPLOAD`
      | `STORED`
      | `AVAILABLE`
      | `EXPIRED`
      | `QUARANTINED`
      | `DELETED`
    >()
    .notNull()
    .default("AWAITING_UPLOAD"),
  statusUpdatedAt: text("status_updated_at").notNull(),
  scanStatus: text("scan_status")
    .$type<`NOT_SCANNED` | `PENDING` | `CLEAN` | `MALICIOUS` | `ERROR`>()
    .notNull()
    .default("NOT_SCANNED"),
  scanStatusUpdatedAt: text("scan_status_updated_at").notNull(),
  expiresAt: text("expired_at").notNull(),
  downloadCount: int("download_count"),
  maxDownloadCount: int("max_download_count"),
  webhookUrl: text("webhook_url"),
  createdAt: timestamps.createdAt,
});

export const outboxTable = sqliteTable("outbox", {
  id: int().primaryKey({ autoIncrement: true }),
  op: text().$type<"COMMIT" | "RELEASE">().notNull(),
  fileId: text("file_id")
    .references((): AnySQLiteColumn => fileTable.fileId)
    .notNull(),
  bytes: int().notNull(),
  leaseUntil: text("lease_until"),
  attempts: int().default(0),
  createdAt: timestamps.createdAt,
});

export const relations = defineRelations({
  fileTable,
  outboxTable,
});
