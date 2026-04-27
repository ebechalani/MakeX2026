import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import 'dotenv/config';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }

const supabase = createClient(url, key, { auth: { persistSession: false } });

const records = JSON.parse(fs.readFileSync('scripts/registrations.json', 'utf8'));

// Fetch categories with tables
const { data: categories, error: catErr } = await supabase
  .from('categories').select('*, tables(*)').order('name');
if (catErr) { console.error('Failed to fetch categories:', catErr); process.exit(1); }

console.log(`Found ${categories.length} categories in DB`);

// Build lookup: "name|age_range_label" → {category, tables[]}
const catLookup = new Map();
for (const c of categories) {
  const k = `${c.name}|${c.age_range_label || ''}`;
  catLookup.set(k, { cat: c, tables: (c.tables || []).filter(t => t.active).sort((a, b) => a.table_number - b.table_number) });
}

// Validate all records map to a known category
const missing = new Set();
for (const r of records) {
  const k = `${r.category_name}|${r.category_age}`;
  if (!catLookup.has(k)) missing.add(k);
}
if (missing.size) { console.error('Missing categories in DB:', [...missing]); process.exit(1); }

// DELETE all existing passations
console.log('Deleting existing passations...');
const { error: delErr, count: delCount } = await supabase
  .from('passations').delete({ count: 'exact' }).not('id', 'is', null);
if (delErr) { console.error('Delete failed:', delErr); process.exit(1); }
console.log(`Deleted ${delCount ?? '?'} passations`);

// Group records by category, distribute round-robin across that category's tables
const grouped = new Map();
for (const r of records) {
  const k = `${r.category_name}|${r.category_age}`;
  if (!grouped.has(k)) grouped.set(k, []);
  grouped.get(k).push(r);
}

const inserts = [];
for (const [k, recs] of grouped) {
  const { cat, tables } = catLookup.get(k);
  if (!tables.length) { console.warn(`No tables for ${k}, skipping ${recs.length} records`); continue; }
  // Round-robin distribute, queue_position is per-table sequence
  const perTable = tables.map(() => 0);
  for (let i = 0; i < recs.length; i++) {
    const tIdx = i % tables.length;
    const r = recs[i];
    inserts.push({
      team_name: r.team_name || r.student_names || 'Unknown',
      student_names: r.student_names || null,
      coach_name: r.coach_name || null,
      parent_name: r.school || null,
      parent_contact: r.parent_contact || null,
      club_name: r.school || null,
      category_id: cat.id,
      table_id: tables[tIdx].id,
      queue_position: ++perTable[tIdx],
      live_status: 'Scheduled',
    });
  }
}

console.log(`Inserting ${inserts.length} passations...`);
// Insert in chunks of 100
for (let i = 0; i < inserts.length; i += 100) {
  const chunk = inserts.slice(i, i + 100);
  const { error } = await supabase.from('passations').insert(chunk);
  if (error) { console.error(`Insert chunk ${i} failed:`, error); process.exit(1); }
  console.log(`  inserted ${Math.min(i + 100, inserts.length)}/${inserts.length}`);
}
console.log('Done.');
