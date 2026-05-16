-- Per-shop admin (creator-based). Stops a manager from managing shops they
-- didn't create — only the creator (and workspace owner) can edit metadata,
-- delete the shop, or change shop_member assignments. Helper canManageShop()
-- enforces this at the route level; SQL just stores the creator pointer.
--
-- Backfill: every existing shop gets created_by = the workspace's primary
-- owner (earliest workspace_members row with role='owner'). This keeps
-- existing data manageable by the workspace owner; managers lose the broad
-- privilege they had until then. Owner can later use PUT /shops/:id/transfer
-- to delegate management to another manager.
ALTER TABLE `shops` ADD `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `shops` SET `created_by` = (
  SELECT wm.user_id FROM `workspace_members` wm
  WHERE wm.workspace_id = `shops`.`workspace_id` AND wm.role = 'owner'
  ORDER BY wm.created_at ASC
  LIMIT 1
);
