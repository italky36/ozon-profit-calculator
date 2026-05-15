-- Remove the global Ozon credentials fallback.
-- After Phase 1 (shared admin shops) the global api_credentials row
-- caused new shops without their own keys to silently pull the catalogue
-- of the admin's Ozon account. Принцип: ключи привязаны только к магазинам.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE `api_credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
