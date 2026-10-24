CREATE TABLE `athlete_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`profile_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `completed_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`activity_type` text NOT NULL,
	`started_at` text NOT NULL,
	`local_date` text NOT NULL,
	`timezone` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`distance_meters` real,
	`elevation_gain_meters` real,
	`name` text,
	`source` text NOT NULL,
	`source_key` text,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `completed_activities_user_date` ON `completed_activities` (`user_id`,`local_date`,`activity_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `completed_activities_source_key` ON `completed_activities` (`user_id`,`source`,`source_key`) WHERE "completed_activities"."source_key" IS NOT NULL;