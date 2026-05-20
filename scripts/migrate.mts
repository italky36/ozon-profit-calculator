/** Apply Drizzle migrations against $DATABASE_URL and exit.
 *  Used by the Docker entrypoint before db:seed runs. */
import { initDb, closeDb } from "../server/db/client";

await initDb();
console.log("[migrate] migrations applied");
await closeDb();
