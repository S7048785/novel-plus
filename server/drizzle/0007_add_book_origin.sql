ALTER TABLE `book` ADD `origin` varchar(16) DEFAULT 'crawl' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_book_origin` ON `book` (`origin`);