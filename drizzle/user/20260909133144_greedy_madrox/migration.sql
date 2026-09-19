CREATE TABLE `quota_ledger` (
	`file_id` text PRIMARY KEY,
	`bytes` integer,
	`state` text,
	`lease_until` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `user` (
	`user_id` integer PRIMARY KEY AUTOINCREMENT,
	`used_byte` integer DEFAULT 0,
	`created_at` text NOT NULL
);
