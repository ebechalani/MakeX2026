// Final SW table layout:
//   SW 4-5: 5 tables (Manual 1..5)              ← drop Auto 1..5
//   SW 6-7: 10 tables (Auto 1..10)               ← rename Manual 1..5 to Auto 1..5; rename existing Auto 1..5 to Auto 6..10
import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: cats } = await supabase.from('categories').select('*');
const sw45 = cats.find(c => /sportswonderland/i.test(c.name) && /4/.test(c.age_range_label || ''));
const sw67 = cats.find(c => /sportswonderland/i.test(c.name) && /6/.test(c.age_range_label || ''));
if (!sw45 || !sw67) throw new Error('Could not locate both SW categories');

console.log('SW 4-5:', sw45.id, '/', sw45.age_range_label);
console.log('SW 6-7:', sw67.id, '/', sw67.age_range_label);

// === SW 4-5: drop Auto 1..5 (table_number 6..10) ===
const { data: t45 } = await supabase.from('tables').select('*').eq('category_id', sw45.id).order('table_number');
console.log(`\nSW 4-5 has ${t45.length} tables before fix`);
const drop45 = t45.filter(t => /^Auto/i.test(t.display_label || ''));
console.log(`  dropping ${drop45.length} auto tables`);
const keep45 = t45.find(t => /^Manual\s*1$/i.test(t.display_label || ''));
if (drop45.length && !keep45) throw new Error('SW 4-5: cannot find Manual 1 to reassign passations to');
// Reassign any passations still on the auto tables to Manual 1 (will be reassigned by scheduler later anyway)
if (drop45.length) {
  const { error: upErr } = await supabase.from('passations').update({ table_id: keep45.id }).in('table_id', drop45.map(t => t.id));
  if (upErr) throw upErr;
  const { error: delErr } = await supabase.from('tables').delete().in('id', drop45.map(t => t.id));
  if (delErr) throw delErr;
  console.log(`  ✓ deleted ${drop45.length} auto tables`);
}
// Update category.table_count
await supabase.from('categories').update({ table_count: 5 }).eq('id', sw45.id);

// === SW 6-7: rename so result is Auto 1..10 ===
const { data: t67 } = await supabase.from('tables').select('*').eq('category_id', sw67.id).order('table_number');
console.log(`\nSW 6-7 has ${t67.length} tables before fix`);
// We expect 10 tables: table_number 1-5 = Manual 1-5, 6-10 = Auto 1-5
// Rename them to Auto 1..10 by table_number order
for (let i = 0; i < t67.length; i++) {
  const newLabel = `Auto ${i + 1}`;
  if (t67[i].display_label !== newLabel) {
    const { error } = await supabase.from('tables').update({ display_label: newLabel }).eq('id', t67[i].id);
    if (error) throw error;
  }
}
console.log(`  ✓ relabeled all ${t67.length} tables to Auto 1..${t67.length}`);
await supabase.from('categories').update({ table_count: t67.length }).eq('id', sw67.id);

console.log('\n✅ SW table layout fixed');
