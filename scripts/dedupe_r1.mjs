// Deletes duplicate round-1 rows (and their round-2 partners) — keeps the earliest by created_at.
import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const TARGETS = [
  { name: 'Laetitia Antoun', club: 'Robateks Academy' },
  { name: 'Abboud Angelo',   club: 'Sainte Famille Francaise Jounieh' },
  { name: 'Choucair Elie',   club: 'Sainte Famille Francaise Jounieh' },
  { name: 'Bachaalany Georges', club: 'Sainte Famille Francaise Jounieh' },
  { name: 'Tanios Joseph',   club: 'Sainte Famille Francaise Jounieh' },
];

const idsToDelete = [];

for (const t of TARGETS) {
  const { data } = await supabase.from('passations')
    .select('id, team_name, club_name, round_number, category_id, created_at')
    .ilike('team_name', t.name)
    .ilike('club_name', t.club);
  if (!data || data.length === 0) { console.log(`✗ no match for ${t.name}`); continue; }
  // Group by (category_id, round_number); keep earliest in each group
  const groups = new Map();
  for (const r of data) {
    const k = `${r.category_id}|${r.round_number}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [, arr] of groups) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const keep = arr[0];
    const drop = arr.slice(1);
    console.log(`${t.name}: keep ${keep.id.slice(0,8)} (R${keep.round_number}), delete ${drop.length} extra`);
    for (const d of drop) idsToDelete.push(d.id);
  }
}

if (idsToDelete.length === 0) { console.log('Nothing to delete'); process.exit(0); }
const { error } = await supabase.from('passations').delete().in('id', idsToDelete);
if (error) { console.error('delete failed:', error.message); process.exit(1); }
console.log(`\n✓ Deleted ${idsToDelete.length} duplicate row(s)`);
