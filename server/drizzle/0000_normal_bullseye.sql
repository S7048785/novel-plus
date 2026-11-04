CREATE TABLE `book` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`author` varchar(255) NOT NULL,
	`book_url` varchar(512) NOT NULL,
	`source_id` int NOT NULL,
	`cover_url` varchar(512),
	`toc_url` varchar(512),
	`intro` text,
	`kind` varchar(255),
	`word_count` varchar(64),
	`latest_chapter_title` varchar(255),
	`total_chapter_num` int,
	`update_time` varchar(64),
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `book_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_book_name_author` UNIQUE(`name`,`author`)
);
--> statement-breakpoint
CREATE TABLE `book_chapter` (
	`id` int AUTO_INCREMENT NOT NULL,
	`book_id` int NOT NULL,
	`title` varchar(512) NOT NULL,
	`url` varchar(512) NOT NULL,
	`index` int NOT NULL,
	`is_vip` boolean NOT NULL DEFAULT false,
	`is_pay` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `book_chapter_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `book_content` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chapter_id` int NOT NULL,
	`content` mediumtext,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `book_content_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_content_chapter` UNIQUE(`chapter_id`)
);
--> statement-breakpoint
CREATE TABLE `crawl_source` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_url` varchar(512) NOT NULL,
	`source_name` varchar(255) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`status` tinyint NOT NULL DEFAULT 0,
	`json` json NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `crawl_source_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crawl_source_url` UNIQUE(`source_url`)
);
--> statement-breakpoint
ALTER TABLE `book` ADD CONSTRAINT `book_source_id_crawl_source_id_fk` FOREIGN KEY (`source_id`) REFERENCES `crawl_source`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `book_chapter` ADD CONSTRAINT `book_chapter_book_id_book_id_fk` FOREIGN KEY (`book_id`) REFERENCES `book`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `book_content` ADD CONSTRAINT `book_content_chapter_id_book_chapter_id_fk` FOREIGN KEY (`chapter_id`) REFERENCES `book_chapter`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_book_source` ON `book` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_chapter_book` ON `book_chapter` (`book_id`,`index`);