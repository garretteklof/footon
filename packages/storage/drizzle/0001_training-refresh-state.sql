CREATE TABLE `training_refresh_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`refresh_version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
