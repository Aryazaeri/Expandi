// Prints the SQL VALUES list for seeding default categories (used in supabase/migrations).
import { DEFAULT_CATEGORIES } from "../src/lib/categories";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
console.log(
  DEFAULT_CATEGORIES.map(
    (c, i) => `      (${q(c.slug)}, ${q(c.name)}, ${q(c.kind)}, ${q(c.icon)}, ${q(c.color)}, ${!!c.fixed}, ${!!c.essential}, ${i})`,
  ).join(",\n"),
);
