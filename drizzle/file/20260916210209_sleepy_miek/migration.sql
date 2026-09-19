PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_file` (
	`file_id` text PRIMARY KEY,
	`owner_id` text,
	`file_blob_id` text NOT NULL,
	`file_name` text,
	`file_type` text,
	`file_size` integer,
	`file_sha256` text,
	`status` text DEFAULT 'AWAITING_UPLOAD' NOT NULL,
	`status_updated_at` text NOT NULL,
	`scan_status` text DEFAULT 'NOT_SCANNED' NOT NULL,
	`scan_status_updated_at` text NOT NULL,
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
PRAGMA foreign_keys=ON;