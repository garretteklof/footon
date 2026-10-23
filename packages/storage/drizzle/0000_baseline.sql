CREATE TABLE `food_logs` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`fdc_id` integer NOT NULL,
	`food_name` text NOT NULL,
	`quantity_g` real NOT NULL,
	`consumed_at` text NOT NULL,
	`nutrients_json` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "food_logs_quantity_positive" CHECK("food_logs"."quantity_g" > 0)
);
--> statement-breakpoint
CREATE INDEX `food_logs_user_day` ON `food_logs` (`user_id`,`consumed_at`);--> statement-breakpoint
CREATE TABLE `training_accounts` (
	`user_id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`account_id` text NOT NULL,
	`credential_ref` text NOT NULL,
	`snapshot_json` text,
	`start_date` text,
	`end_date` text,
	`synced_at` text,
	`refresh_version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `training_accounts_provider_account` ON `training_accounts` (`provider`,`account_id`);--> statement-breakpoint
CREATE TABLE `identities` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`platform`, `external_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `identities_user` ON `identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`display_name` text,
	`timezone` text DEFAULT 'UTC' NOT NULL
);
