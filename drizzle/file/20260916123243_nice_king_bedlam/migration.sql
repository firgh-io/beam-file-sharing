PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_file` (
	`file_id` text PRIMARY KEY,
	`owner_id` text,
	`file_blob_id` text NOT NULL,
	`file_name` text,
	`file_type` text,
	`file_size` integer,
	`file_sha256` text,
	`status` text DEFAULT 'AWAITING_UPLOAD',
	`status_updated_at` text,
	`scan_status` text DEFAULT 'NOT_SCANNED',
	`scan_status_updated_at` text,
	`expired_at` text NOT NULL,
	`download_count` integer,
	`max_download_count` integer,
	`webhook_url` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_file`(`file_id`, `owner_id`, `file_blob_id`, `file_name`, `file_type`, `file_size`, `file_sha256`, `status`, `status_updated_at`, `scan_status`, `scan_status_updated_at`, `expired_at`, `download_count`, `max_download_count`, `webhook_url`, `created_at`) SELECT `file_id`, `owner_id`, `file_blob_id`, `file_name`, `file_type`, `file_size`, `file_sha256`, `status`, `status_updated_at`, `scan_status`, `scan_status_updated_at`, `expired_at`, `download_count`, `max_download_count`, `webhook_url`, `created_at` FROM `file`;--> statement-breakpoint
DROP TABLE `file`;--> statement-breakpoint
ALTER TABLE `__new_file` RENAME TO `file`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`op` text NOT NULL,
	`file_id` text NOT NULL,
	`bytes` integer NOT NULL,
	`lease_until` text,
	`attempts` integer DEFAULT 0,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_outbox_file_id_file_file_id_fk` FOREIGN KEY (`file_id`) REFERENCES `file`(`file_id`)
);
--> statement-breakpoint
INSERT INTO `__new_outbox`(`id`, `op`, `file_id`, `bytes`, `lease_until`, `attempts`, `created_at`) SELECT `id`, `op`, `file_id`, `bytes`, `lease_until`, `attempts`, `created_at` FROM `outbox`;--> statement-breakpoint
DROP TABLE `outbox`;--> statement-breakpoint
ALTER TABLE `__new_outbox` RENAME TO `outbox`;--> statement-breakpoint
PRAGMA foreign_keys=ON;