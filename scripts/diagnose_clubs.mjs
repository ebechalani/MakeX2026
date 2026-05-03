import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: pas } = await supabase.from('passations').select('club_name');
const { data: acs } = await supabase.from('academies').select('name');

function fuzzy(s) {
  if (!s) return '';
  // strip accents, mojibake-fix, lowercase, collapse whitespace, strip punctuation
  let x = s;
  if (/Ã.|Â./.test(x)) {
    try { x = Buffer.from(x, 'latin1').toString('utf8'); } catch {}
  }
  return x.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const counts = new Map(); // raw club_name → count
for (const p of pas) {
  if (!p.club_name) continue;
  counts.set(p.club_name, (counts.get(p.club_name) ?? 0) + 1);
}

console.log(`\nDistinct club_name values in passations: ${counts.size}`);
console.log(`Academies in academies table: ${acs.length}\n`);

// Group by fuzzy key
const byFuzzy = new Map();
for (const [name, n] of counts) {
  const k = fuzzy(name);
  if (!byFuzzy.has(k)) byFuzzy.set(k, []);
  byFuzzy.get(k).push({ name, n });
}
for (const a of acs) {
  const k = fuzzy(a.name);
  if (!byFuzzy.has(k)) byFuzzy.set(k, []);
  byFuzzy.get(k).push({ name: `[ACADEMY] ${a.name}`, n: 0 });
}

console.log('=== Variants under same fuzzy key ===');
for (const [k, arr] of byFuzzy) {
  if (arr.length <= 1) continue;
  console.log(`\nfuzzy "${k}":`);
  for (const x of arr) console.log(`  - "${x.name}"  (${x.n})`);
}

// Singletons (no academy match) — possibly typos
console.log('\n=== club_name in passations with NO matching academy (fuzzy) ===');
const acFuzzy = new Set(acs.map(a => fuzzy(a.name)));
for (const [name, n] of counts) {
  if (!acFuzzy.has(fuzzy(name))) console.log(`  - "${name}"  (${n} students)`);
}
