CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_smart` integer DEFAULT false NOT NULL,
	`smart_filter_json` text,
	`parent_group_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `groups_parent_group_id_idx` ON `groups` (`parent_group_id`);--> statement-breakpoint
CREATE TABLE `repo_groups` (
	`repo_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`added_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`repo_id`, `group_id`),
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repo_groups_group_id_idx` ON `repo_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`full_path` text NOT NULL,
	`remote_url` text,
	`default_branch` text,
	`current_branch` text,
	`last_commit_hash` text,
	`last_commit_date` text,
	`last_commit_msg` text,
	`is_dirty` integer DEFAULT false NOT NULL,
	`primary_language` text,
	`languages_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`description` text,
	`readme_content` text,
	`readme_hash` text,
	`size_bytes` integer,
	`last_scanned_at` text,
	`last_opened_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source` text DEFAULT 'filesystem_scan' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repos_slug_unique` ON `repos` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `repos_full_path_unique` ON `repos` (`full_path`);--> statement-breakpoint
CREATE INDEX `repos_primary_language_idx` ON `repos` (`primary_language`);--> statement-breakpoint
CREATE INDEX `repos_last_commit_date_idx` ON `repos` (`last_commit_date`);--> statement-breakpoint
CREATE INDEX `repos_last_scanned_at_idx` ON `repos` (`last_scanned_at`);--> statement-breakpoint
CREATE TABLE `scan_paths` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_scanned_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_paths_path_unique` ON `scan_paths` (`path`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`data_json` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
