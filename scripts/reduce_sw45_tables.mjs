// SW 4-5 → reduce from 5 tables to 3 (drop Manual 4 and Manual 5).
import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: cats } = await supabase.from('categories').select('*');
const sw45 = cats.find(c => /sportswonderland/i.test(c.name) && /4/.test(c.age_range_label || ''));
if (!sw45) throw new Error('SW 4-5 not found');
console.log(`Target: ${sw45.name} ${sw45.age_range_label}`);

const { data: existing } = await supabase.from('tables').select('*').eq('category_id', sw45.id).order('table_number');
console.log(`Currently ${existing.length} tables: ${existing.map(t => t.display_label || `Table ${t.table_number}`).join(', ')}`);

// Drop tables with table_number > 3
const drop = existing.filter(t => t.table_number > 3);
const keep = existing.find(t => t.table_number === 1);
if (!keep) throw new Error('Manual 1 missing — cannot reassign');

console.log(`Dropping ${drop.length} tables: ${drop.map(t => t.display_label).join(', ')}`);

// Reassign any passations on those tables to Manual 1 (will be reshuffled by the scheduler)
if (drop.length) {
  const { error: upErr, count } = await supabase.from('passations')
    .update({ table_id: keep.id }, { count: 'exact' })
    .in('table_id', drop.map(t => t.id));
  if (upErr) throw upErr;
  console.log(`  reassigned ${count ?? '?'} passations onto ${keep.display_label}`);

  const { error: delErr } = await supabase.from('tables').delete().in('id', drop.map(t => t.id));
  if (delErr) throw delErr;
  console.log('  ✓ tables deleted');
}

// Update category.table_count to 3
await supabase.from('categories').update({ table_count: 3 }).eq('id', sw45.id);
console.log('  ✓ category.table_count = 3');

console.log('\n✅ Done. Now run: node --env-file=.env.local scripts/generate_schedule.mjs');
