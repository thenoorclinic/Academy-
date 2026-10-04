/** Ejecuta la sincronización completa desde la terminal: npm run sync */
import { db } from "../src/db";
import { runFullSync } from "../src/services/pipeline";

const clinics = await db.query.clinics.findMany({ columns: { id: true, name: true } });
for (const c of clinics) {
  console.log(`→ ${c.name}`);
  console.log(JSON.stringify(await runFullSync(c.id, "cron"), null, 2));
}
process.exit(0);
