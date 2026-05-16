-- Sysadmin can pause a workspace without nuking its data. Members of a
-- suspended workspace can't log in or hold sessions; sysadmins are unaffected.
-- NULL → active, non-NULL → timestamp when sysadmin suspended it.
ALTER TABLE `workspaces` ADD `suspended_at` integer;
