ALTER TABLE `book_chapter` DROP FOREIGN KEY `book_chapter_book_id_book_id_fk`;
--> statement-breakpoint
ALTER TABLE `book_content` DROP FOREIGN KEY `book_content_chapter_id_book_chapter_id_fk`;
--> statement-breakpoint
ALTER TABLE `book_chapter` DROP COLUMN `is_vip`;--> statement-breakpoint
ALTER TABLE `book_chapter` DROP COLUMN `is_pay`;