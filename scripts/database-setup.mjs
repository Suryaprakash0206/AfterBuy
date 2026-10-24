import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function buildDatabaseSetup() {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const migrations = await Promise.all(
    files.map(
      async (file) =>
        `-- Migration: ${file}\n${await readFile(new URL(file, directory), "utf8")}`,
    ),
  );
  return `-- AfterBuy: initial database setup, generated from ${files.length} migrations.
-- Paste this entire file into your Supabase project's SQL Editor and Run.
-- For a fresh AfterBuy installation only. Existing Auth accounts are preserved.
-- All changes commit together; an error rolls the setup back.
begin;
do $$ begin
 if to_regclass('public.workspaces') is not null then
  raise exception 'Workspace tables already exist. Apply only pending migrations instead of running initial setup again.';
 end if;
end $$;
${migrations.join("\n\n")}
notify pgrst, 'reload schema';
commit;
`;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const output = new URL("../supabase/setup.sql", import.meta.url);
  await writeFile(output, await buildDatabaseSetup());
  console.log(`Database setup ready: ${fileURLToPath(output)}`);
}
