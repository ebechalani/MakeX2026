import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Target layout: { name, age_range_label, table_count }
const TARGET = [
  { name: 'Sportswonderland', age_range_label: '4–5 years old',   table_count: 5 },
  { name: 'Sportswonderland', age_range_label: '6–7 years old',   table_count: 5 },
  { name: 'Capelli Inspire',  age_range_label: '8–12 years old',  table_count: 5 },
  { name: 'Capelli Starter',  age_range_label: '13–15 years old', table_count: 2 },
  { name: 'Capelli Soccer',   age_range_label: '',                 table_count: 1 },
  { name: 'MakeX Inspire',    age_range_label: '8–12 years old',  table_count: 5 },
  { name: 'MakeX Starter',    age_range_label: '11–13 years old', table_count: 1 },
];

// 1. Delete all passations
console.log('Deleting passations...');
{
  const { error, count } = await supabase.from('passations').delete({ count: 'exact' }).not('id', 'is', null);
  if (error) throw error;
  console.log(`  deleted ${count}`);
}

// 2. Delete all tables
console.log('Deleting tables...');
{
  const { error, count } = await supabase.from('tables').delete({ count: 'exact' }).not('id', 'is', null);
  if (error) throw error;
  console.log(`  deleted ${count}`);
}

// 3. Wipe categories and reinsert from TARGET
console.log('Deleting categories...');
{
  const { error, count } = await supabase.from('categories').delete({ count: 'exact' }).not('id', 'is', null);
  if (error) throw error;
  console.log(`  deleted ${count}`);
}

const { data: finalCats, error: insErr } = await supabase.from('categories')
  .insert(TARGET.map(t => ({ name: t.name, age_range_label: t.age_range_label, table_count: t.table_count, active: true })))
  .select();
if (insErr) throw insErr;
console.log(`Inserted ${finalCats.length} categories`);

// 4. Recreate tables for each category
console.log('Recreating tables...');
const tableInserts = [];
for (const c of finalCats) {
  for (let n = 1; n <= c.table_count; n++) {
    tableInserts.push({ category_id: c.id, table_number: n, display_label: `Table ${n}`, active: true });
  }
}
const { error: tErr } = await supabase.from('tables').insert(tableInserts);
if (tErr) throw tErr;
console.log(`  created ${tableInserts.length} tables`);

console.log('Done. Categories:');
for (const c of finalCats) console.log(`  ${c.name} | ${c.age_range_label} → ${c.table_count} tables`);
