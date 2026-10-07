CREATE TABLE `record_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`state_revision` integer NOT NULL,
	`record_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`before_record` text,
	`after_record` text
);
--> statement-breakpoint
CREATE INDEX `record_audit_record_id_idx` ON `record_audit` (`record_id`,`id`);--> statement-breakpoint
ALTER TABLE `shared_state` ADD `mutation_id` text DEFAULT 'legacy' NOT NULL;