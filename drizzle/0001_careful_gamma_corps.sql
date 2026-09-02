CREATE TABLE `building` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`is_clinical` integer DEFAULT false NOT NULL,
	`clinical_mode` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pair_grid` (
	`pair_no` integer PRIMARY KEY NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`academic_hours` integer DEFAULT 2 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`building_id` integer NOT NULL,
	`number` text NOT NULL,
	`name` text,
	`capacity` integer,
	`room_type` text NOT NULL,
	`pinned_teacher_id` integer,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `building`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `speciality` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`qualification` text,
	`semesters_total` integer DEFAULT 6 NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `speciality_code_unique` ON `speciality` (`code`);--> statement-breakpoint
CREATE TABLE `curriculum` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`speciality_id` integer NOT NULL,
	`admission_year` integer NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_at` text,
	`approved_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`speciality_id`) REFERENCES `speciality`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `curriculum_row` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`curriculum_id` integer NOT NULL,
	`discipline_id` integer NOT NULL,
	`course` integer NOT NULL,
	`semester_no` integer NOT NULL,
	`credits` integer NOT NULL,
	`hours_total` integer NOT NULL,
	`hours_classroom` integer NOT NULL,
	`hours_theory` integer DEFAULT 0 NOT NULL,
	`hours_practice` integer DEFAULT 0 NOT NULL,
	`hours_seminar` integer DEFAULT 0 NOT NULL,
	`hours_lab` integer DEFAULT 0 NOT NULL,
	`hours_srs` integer DEFAULT 0 NOT NULL,
	`control_semester` integer,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`supersedes_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`curriculum_id`) REFERENCES `curriculum`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`discipline_id`) REFERENCES `discipline`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_id`) REFERENCES `curriculum_row`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `curriculum_week` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`curriculum_row_id` integer NOT NULL,
	`week_no` integer NOT NULL,
	`hours` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`curriculum_row_id`) REFERENCES `curriculum_row`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_curriculum_week` ON `curriculum_week` (`curriculum_row_id`,`week_no`);--> statement-breakpoint
CREATE TABLE `discipline` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`index_code` text,
	`block` integer NOT NULL,
	`cycle` text NOT NULL,
	`part` text NOT NULL,
	`difficulty` integer DEFAULT 1 NOT NULL,
	`default_room_type` text,
	`requires_clinical` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `academic_year` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academic_year_name_unique` ON `academic_year` (`name`);--> statement-breakpoint
CREATE TABLE `calendar_day` (
	`date` text PRIMARY KEY NOT NULL,
	`semester_id` integer,
	`kind` text NOT NULL,
	`moved_from_date` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`semester_id`) REFERENCES `semester`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `calendar_period` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`course` integer,
	`speciality_id` integer,
	`group_id` integer,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`speciality_id`) REFERENCES `speciality`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `semester` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`academic_year_id` integer NOT NULL,
	`no` integer NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`weeks_count` integer DEFAULT 18 NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`academic_year_id`) REFERENCES `academic_year`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `cmc` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`head_teacher_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`head_teacher_id`) REFERENCES `teacher`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `division_scheme` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`semester_id` integer NOT NULL,
	`name` text NOT NULL,
	`parts_count` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `study_group`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`semester_id`) REFERENCES `semester`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `study_group` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`speciality_id` integer NOT NULL,
	`admission_year` integer NOT NULL,
	`course` integer NOT NULL,
	`students_count` integer NOT NULL,
	`max_pairs_per_day` integer DEFAULT 6 NOT NULL,
	`max_hours_per_week` integer DEFAULT 45 NOT NULL,
	`funding` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`merged_into_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`speciality_id`) REFERENCES `speciality`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`merged_into_id`) REFERENCES `study_group`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `subgroup` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`scheme_id` integer NOT NULL,
	`no` integer NOT NULL,
	`pos_from` integer NOT NULL,
	`pos_to` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `study_group`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`scheme_id`) REFERENCES `division_scheme`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_subgroup_scheme_no` ON `subgroup` (`scheme_id`,`no`);--> statement-breakpoint
CREATE TABLE `teacher` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`last_name` text NOT NULL,
	`first_name` text NOT NULL,
	`middle_name` text,
	`cmc_id` integer,
	`category_id` integer NOT NULL,
	`rate` real DEFAULT 1 NOT NULL,
	`max_hours_year` integer,
	`max_pairs_per_day` integer,
	`phone` text,
	`main_workplace` text,
	`availability_note` text,
	`hired_at` text,
	`fired_at` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`cmc_id`) REFERENCES `cmc`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `teacher_category`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `teacher_absence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`teacher_id` integer NOT NULL,
	`kind` text NOT NULL,
	`scope` text NOT NULL,
	`day_of_week` integer,
	`date_from` text,
	`date_to` text,
	`pair_from` integer NOT NULL,
	`pair_to` integer NOT NULL,
	`weight` integer DEFAULT 0 NOT NULL,
	`reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teacher`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `teacher_category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`title_ru` text NOT NULL,
	`norm_hours_year` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_category_code_unique` ON `teacher_category` (`code`);--> statement-breakpoint
CREATE TABLE `teacher_qualification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`teacher_id` integer NOT NULL,
	`discipline_id` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teacher`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`discipline_id`) REFERENCES `discipline`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_qual_teacher` ON `teacher_qualification` (`teacher_id`,`discipline_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `stream` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`semester_id` integer NOT NULL,
	`name` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`semester_id`) REFERENCES `semester`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `stream_member` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stream_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`stream_id`) REFERENCES `stream`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`group_id`) REFERENCES `study_group`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_stream_member` ON `stream_member` (`stream_id`,`group_id`);--> statement-breakpoint
CREATE TABLE `teaching_load` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`semester_id` integer NOT NULL,
	`curriculum_row_id` integer NOT NULL,
	`teacher_id` integer NOT NULL,
	`group_id` integer,
	`stream_id` integer,
	`division_scheme_id` integer,
	`subgroup_id` integer,
	`lesson_kind` text NOT NULL,
	`hours_planned` integer NOT NULL,
	`requires_parallel` integer DEFAULT false NOT NULL,
	`paired_load_id` integer,
	`room_type_required` text,
	`room_id_fixed` integer,
	`building_id_required` integer,
	`clinical_mode_override` text,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`semester_id`) REFERENCES `semester`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`curriculum_row_id`) REFERENCES `curriculum_row`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`teacher_id`) REFERENCES `teacher`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`group_id`) REFERENCES `study_group`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`stream_id`) REFERENCES `stream`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`division_scheme_id`) REFERENCES `division_scheme`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subgroup_id`) REFERENCES `subgroup`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`paired_load_id`) REFERENCES `teaching_load`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_load_semester` ON `teaching_load` (`semester_id`,`teacher_id`);--> statement-breakpoint
CREATE TABLE `backup` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`created_at` text NOT NULL,
	`reason` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`schema_version` text
);
--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_id` integer,
	`entity` text NOT NULL,
	`entity_id` integer NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`at` text NOT NULL,
	`user` text DEFAULT 'admin' NOT NULL,
	`reason` text,
	FOREIGN KEY (`operation_id`) REFERENCES `operation`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_change_log_entity` ON `change_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `constraint_weight` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`weight` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`semester_id` integer,
	`title_ru` text NOT NULL,
	`description_ru` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`semester_id`) REFERENCES `semester`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `operation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`params_json` text,
	`summary_json` text,
	`status` text DEFAULT 'preview' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`created_by` text DEFAULT 'admin' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operation_snapshot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_id` integer NOT NULL,
	`table_name` text NOT NULL,
	`row_id` integer NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operation`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_operation_snapshot_operation` ON `operation_snapshot` (`operation_id`);--> statement-breakpoint
CREATE TABLE `other_load` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`semester_id` integer NOT NULL,
	`teacher_id` integer NOT NULL,
	`kind` text NOT NULL,
	`hours` integer NOT NULL,
	`group_id` integer,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`semester_id`) REFERENCES `semester`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`teacher_id`) REFERENCES `teacher`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`group_id`) REFERENCES `study_group`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `lesson` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`pair_no` integer NOT NULL,
	`teaching_load_id` integer NOT NULL,
	`teacher_id` integer NOT NULL,
	`room_id` integer,
	`discipline_id` integer NOT NULL,
	`lesson_kind` text NOT NULL,
	`academic_hours` integer DEFAULT 2 NOT NULL,
	`template_entry_id` integer,
	`template_id` integer,
	`status` text DEFAULT 'planned' NOT NULL,
	`moved_to_lesson_id` integer,
	`operation_id` integer NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`teaching_load_id`) REFERENCES `teaching_load`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`teacher_id`) REFERENCES `teacher`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`discipline_id`) REFERENCES `discipline`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`template_entry_id`) REFERENCES `template_entry`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`template_id`) REFERENCES `schedule_template`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`moved_to_lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`operation_id`) REFERENCES `operation`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_lesson_date_pair` ON `lesson` (`date`,`pair_no`);--> statement-breakpoint
CREATE INDEX `idx_lesson_teacher_date` ON `lesson` (`teacher_id`,`date`,`pair_no`);--> statement-breakpoint
CREATE INDEX `idx_lesson_room_date` ON `lesson` (`room_id`,`date`,`pair_no`);--> statement-breakpoint
CREATE INDEX `idx_lesson_load` ON `lesson` (`teaching_load_id`);--> statement-breakpoint
-- §4.4: уникальные индексы ниже — дешёвая страховка от программной ошибки, а не полная
-- защита предметной области. Они ловят «тот же преподаватель / тот же кабинет в том же
-- слоте», но принципиально НЕ ловят главный конфликт: занятие клин. п/гр 1 ({1-10}) и
-- занятие англ. п/гр 1 ({1-15}) в одном слоте — номера подгрупп разные, а студенты 1-10
-- пересекаются. Уникального индекса по группе поэтому нет: занятие потока — одна строка
-- lesson на несколько групп. Проверка пересечения отрезков lesson_group.pos_from/pos_to
-- живёт в сервисе (§4.6, §4.7), покрыта индексом idx_lg_group и отдельными тестами.
CREATE UNIQUE INDEX `uq_lesson_teacher` ON `lesson` (`teacher_id`,`date`,`pair_no`) WHERE "lesson"."status" in ('planned','held');--> statement-breakpoint
CREATE UNIQUE INDEX `uq_lesson_room` ON `lesson` (`room_id`,`date`,`pair_no`) WHERE "lesson"."status" in ('planned','held') and "lesson"."room_id" is not null;--> statement-breakpoint
CREATE TABLE `lesson_group` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`subgroup_id` integer,
	`pos_from` integer NOT NULL,
	`pos_to` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`group_id`) REFERENCES `study_group`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subgroup_id`) REFERENCES `subgroup`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_lg_group` ON `lesson_group` (`group_id`,`lesson_id`);--> statement-breakpoint
CREATE INDEX `idx_lg_lesson` ON `lesson_group` (`lesson_id`);--> statement-breakpoint
CREATE TABLE `schedule_template` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`semester_id` integer NOT NULL,
	`version_no` integer NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`based_on_id` integer,
	`note` text,
	`created_by` text DEFAULT 'admin' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`semester_id`) REFERENCES `semester`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`based_on_id`) REFERENCES `schedule_template`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `substitution` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`kind` text NOT NULL,
	`original_teacher_id` integer NOT NULL,
	`substitute_teacher_id` integer,
	`original_room_id` integer,
	`new_room_id` integer,
	`reason` text,
	`document_no` text,
	`created_by` text DEFAULT 'admin' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`original_teacher_id`) REFERENCES `teacher`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`substitute_teacher_id`) REFERENCES `teacher`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`original_room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`new_room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `template_entry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`day_of_week` integer NOT NULL,
	`pair_no` integer NOT NULL,
	`teaching_load_id` integer NOT NULL,
	`room_id` integer,
	`week_parity` text DEFAULT 'all' NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `schedule_template`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`teaching_load_id`) REFERENCES `teaching_load`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_template_entry_slot` ON `template_entry` (`template_id`,`day_of_week`,`pair_no`);