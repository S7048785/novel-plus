ALTER TABLE `book` ADD `author_id` varchar(36);--> statement-breakpoint
CREATE INDEX `idx_book_author` ON `book` (`author_id`);