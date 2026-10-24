CREATE TABLE `vitals_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`metric` text NOT NULL,
	`value_num` real NOT NULL,
	`unit` text NOT NULL,
	`observed_at` text NOT NULL,
	`local_date` text NOT NULL,
	`timezone` text NOT NULL,
	`source` text NOT NULL,
	`source_key` text,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vitals_observations_user_metric_date` ON `vitals_observations` (`user_id`,`metric`,`local_date`);--> statement-breakpoint
CREATE INDEX `vitals_observations_user_time` ON `vitals_observations` (`user_id`,`observed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `vitals_observations_source_key` ON `vitals_observations` (`user_id`,`source`,`source_key`) WHERE "vitals_observations"."source_key" IS NOT NULL;