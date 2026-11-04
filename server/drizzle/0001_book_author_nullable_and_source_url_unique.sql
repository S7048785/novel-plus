ALTER TABLE `book` DROP INDEX `uq_book_name_author`;--> statement-breakpoint
ALTER TABLE `book` MODIFY COLUMN `author` varchar(255);--> statement-breakpoint
ALTER TABLE `book` ADD CONSTRAINT `uq_book_source_url` UNIQUE(`source_id`,`book_url`);