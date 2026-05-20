-- Workspace-level branding for the header badge. `logo_data_url` stores the
-- raw data URL ("data:image/png;base64,...") so we don't need a file store;
-- the backend caps size at 200 KB. `color` is a HEX accent for the badge bg
-- (separate from shops.color and from the global UI accent in TweaksPanel).
ALTER TABLE `workspaces` ADD `logo_data_url` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `color` text;
