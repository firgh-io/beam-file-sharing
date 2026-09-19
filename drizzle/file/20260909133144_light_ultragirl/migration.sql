CREATE TABLE `file` (
	`file_id` text PRIMARY KEY,
	`owner_id` text,
	`file_blob_id` text,
	`file_name` text,
	`file_type` text,
	`file_size` integer,
	`file_sha256` text,
	`status` text DEFAULT 'AWAITING_UPLOAD',
	`status_updated_at` text,
	`scan_status` text DEFAULT 'NOT_SCANNED',
	`scan_status_updated_at` text,
	`expired_at` text,
	`download_count` text,
	`max_download_count` text,
	`webhook_url` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`op` text,
	`file_id` text,
	`bytes` integer,
	`lease_until` text,
	`attempts` integer,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_outbox_file_id_file_file_id_fk` FOREIGN KEY (`file_id`) REFERENCES `file`(`file_id`)
);
