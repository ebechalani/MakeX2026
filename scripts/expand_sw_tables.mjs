// Adds 5 "Auto" tables to each SportsWonderland category, and renames existing 5 to "Manual N".
import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: cats, error: cErr } = await supabase.from('categories').select('*');
if (cErr) throw cErr;

const swCats = cats.filter(c => /sports\s*wonderland/i.test(c.name));
console.log(`Found ${swCats.length} SportsWonderland categor${swCats.length === 1 ? 'y' : 'ies'}`);

for (const cat of swCats) {
  console.log(`\n→ ${cat.name} (${cat.age_range_label || ''})`);
  // Existing tables
  const { data: existing } = await supabase.from('tables').select('*').eq('category_id', cat.id).order('table_number');
  console.log(`  existing tables: ${existing.length}`);
  // Re-label existing as "Manual N"
  for (let i = 0; i < existing.length; i++) {
    const newLabel = `Manual ${i + 1}`;
    if (existing[i].display_label !== newLabel) {
      await supabase.from('tables').update({ display_label: newLabel }).eq('id', existing[i].id);
    }
  }
  // Add 5 auto tables
  const startNum = (existing.at(-1)?.table_number || 0) + 1;
  const newRows = [];
  for (let i = 0; i < 5; i++) {
    newRows.push({
      category_id: cat.id,
      table_number: startNum + i,
      display_label: `Auto ${i + 1}`,
      active: true,
    });
  }
  const { error: insErr } = await supabase.from('tables').insert(newRows);
  if (insErr) { console.error('  insert failed:', insErr.message); continue; }
  console.log(`  + added ${newRows.length} auto tables (Auto 1..5, table_number ${startNum}..${startNum + 4})`);
  // Update category.table_count to reflect new total
  await supabase.from('categories').update({ table_count: existing.length + 5 }).eq('id', cat.id);
}

console.log('\n✓ Done.');
