import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: pas, error } = await supabase
  .from('passations')
  .select('id, team_name, student_names, category_id, created_at')
  .eq('club_name', 'RoboHolic');
if (error) throw error;

const norm = s => (s || '').trim().toLowerCase();
const groups = new Map();
for (const p of pas) {
  // Key includes category_id so a student legitimately competing in 2 categories isn't merged
  const k = norm(p.team_name) + '|' + norm(p.student_names) + '|' + p.category_id;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(p);
}

const toDelete = [];
const toKeep = [];
for (const [, arr] of groups) {
  if (arr.length === 1) continue;
  // Keep earliest by created_at, delete the rest
  arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  toKeep.push(arr[0]);
  for (const p of arr.slice(1)) toDelete.push(p);
}

console.log(`Found ${toDelete.length} duplicate(s) to delete:`);
for (const p of toDelete) console.log(`  - ${p.team_name} (id ${p.id.slice(0,8)}, created ${p.created_at})`);
console.log(`\nKeeping ${toKeep.length} canonical record(s):`);
for (const p of toKeep) console.log(`  - ${p.team_name} (id ${p.id.slice(0,8)}, created ${p.created_at})`);

if (toDelete.length === 0) {
  console.log('\nNothing to do.');
  process.exit(0);
}

const ids = toDelete.map(p => p.id);
const { error: dErr } = await supabase.from('passations').delete().in('id', ids);
if (dErr) { console.error('Delete failed:', dErr.message); process.exit(1); }
console.log(`\n✓ Deleted ${ids.length} duplicate passation(s).`);
