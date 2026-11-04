-- 用户身份（多对多）+ 书籍归属人
--
-- 只保留真正改变结构的三段：建 user_role、加 book.owner_id、加索引与外键。
-- drizzle-kit 生成的原始文件里还夹了几条 `MODIFY COLUMN`（book.id / book_url / source_id 等），
-- 那是历史快照落后于 schema 造成的「假差异」——数据库里这些列早已是目标形态（已逐列核对
-- information_schema），执行它们只会把表重建一遍，收益为零。快照已一并修正，后续生成不再出现。
--
-- 注意：本项目的迁移一直是手动执行的（库里没有 drizzle 的 __drizzle_migrations 记账表），
-- 所以 `drizzle-kit migrate` 在这里不适用，直接执行本文件的语句即可。

CREATE TABLE `user_role` (
	`user_id` varchar(36) NOT NULL,
	`role` varchar(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `user_role_user_id_role_pk` PRIMARY KEY(`user_id`,`role`)
);
--> statement-breakpoint
ALTER TABLE `book` ADD `owner_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `user_role` ADD CONSTRAINT `user_role_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `idx_user_role_role` ON `user_role` (`role`);
--> statement-breakpoint
CREATE INDEX `idx_book_owner` ON `book` (`owner_id`);
--> statement-breakpoint
-- 数据回填：现有账号一律授予「读者 + 管理员」。
-- 读者是所有账号的基础身份（不落库就会在权限判断里变成特例），管理员让现有运营号还能进后台；
-- 作家身份按需在后台再勾。INSERT IGNORE 让本段可重复执行（复合主键冲突直接跳过）。
INSERT IGNORE INTO `user_role` (`user_id`, `role`) SELECT `id`, 'reader' FROM `user`;
--> statement-breakpoint
INSERT IGNORE INTO `user_role` (`user_id`, `role`) SELECT `id`, 'admin' FROM `user`;
