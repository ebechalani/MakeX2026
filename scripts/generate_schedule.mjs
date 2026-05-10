// Schedule for May 31, 2026 — ONE ROW PER STUDENT (round 1 only).
// SportsWonderland: 14:00 start. All others (except MakeX Starter): 10:00 start.
// 5-minute slots. Same-club students sit on the same table. If a club is too big for one
// table, it spills onto the next least-loaded table (still consecutively per table).
import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const EVENT_DATE = '2026-05-31';
const DEFAULT_SLOT = 5;

function slotMinutesFor(_catName) {
  // Per latest decision: every passation is 5 minutes
  return DEFAULT_SLOT;
}

function startTimeFor(catName) {
  if (/sports\s*wonderland/i.test(catName)) return `${EVENT_DATE}T14:00:00`;
  return `${EVENT_DATE}T10:00:00`;
}
function isSkipped(catName) {
  return /signal\s*rise/i.test(catName) || /makex\s*starter/i.test(catName);
}

const { data: cats } = await supabase.from('categories').select('*').order('name');
const { data: tables } = await supabase.from('tables').select('*').eq('active', true).order('table_number');

// Wipe any prior round-2 rows so we can rebuild cleanly.
const { error: delR2 } = await supabase.from('passations').delete().eq('round_number', 2);
if (delR2) { console.error('round-2 cleanup failed:', delR2.message); process.exit(1); }
console.log('✓ cleared previous round-2 rows');

const { data: pass } = await supabase.from('passations').select('*').eq('round_number', 1);

console.log(`Categories: ${cats.length}, tables: ${tables.length}, students: ${pass.length}\n`);

const tablesByCat = new Map();
for (const t of tables) {
  if (!tablesByCat.has(t.category_id)) tablesByCat.set(t.category_id, []);
  tablesByCat.get(t.category_id).push(t);
}

const updates = [];
const round2Inserts = [];
const overflowReport = [];

const ROUND2_OFFSET_MS = 60 * 60 * 1000; // round 2 starts 1 hour after round 1

for (const cat of cats) {
  if (isSkipped(cat.name)) {
    console.log(`⏭  Skip: ${cat.name}`);
    continue;
  }
  const startISO = startTimeFor(cat.name);
  const startMs = new Date(startISO).getTime();
  const SLOT_MINUTES = slotMinutesFor(cat.name);
  const catTables = (tablesByCat.get(cat.id) || []).slice().sort((a, b) => a.table_number - b.table_number);
  const catStudents = pass.filter(p => p.category_id === cat.id);
  if (catTables.length === 0 || catStudents.length === 0) continue;

  // Target spread per table
  const target = Math.ceil(catStudents.length / catTables.length);

  // Group by club, sort clubs by size descending (place big clubs first → balances better)
  const clubs = new Map();
  for (const p of catStudents) {
    const k = (p.club_name || '__').trim();
    if (!clubs.has(k)) clubs.set(k, []);
    clubs.get(k).push(p);
  }
  const orderedClubs = Array.from(clubs.values()).sort((a, b) => b.length - a.length);

  // Buckets per table
  const buckets = catTables.map(() => []);

  for (const club of orderedClubs) {
    const remaining = club.slice();
    while (remaining.length > 0) {
      // Pick the least-loaded table that's still under target.
      // If all are at/over target, pick the absolute least-loaded (overflow).
      let bestUnder = -1, bestUnderSize = Infinity;
      let bestAny = -1, bestAnySize = Infinity;
      for (let i = 0; i < buckets.length; i++) {
        if (buckets[i].length < target && buckets[i].length < bestUnderSize) {
          bestUnder = i; bestUnderSize = buckets[i].length;
        }
        if (buckets[i].length < bestAnySize) {
          bestAny = i; bestAnySize = buckets[i].length;
        }
      }
      const pick = bestUnder !== -1 ? bestUnder : bestAny;
      const room = bestUnder !== -1 ? (target - buckets[pick].length) : remaining.length;
      buckets[pick].push(...remaining.splice(0, room));
    }
  }

  const peak = Math.max(...buckets.map(b => b.length));
  const peakMin = peak * SLOT_MINUTES;
  console.log(`\n→ ${cat.name} ${cat.age_range_label || ''} — ${catStudents.length} students, ${catTables.length} tables, ${SLOT_MINUTES}min slots, target ${target}/table, peak ${peak} = ${peakMin}min`);
  for (let i = 0; i < buckets.length; i++) {
    const t = catTables[i];
    const lbl = t.display_label || `Table ${t.table_number}`;
    // Show distinct clubs on this table
    const clubsHere = new Map();
    for (const p of buckets[i]) clubsHere.set(p.club_name || '—', (clubsHere.get(p.club_name || '—') ?? 0) + 1);
    const parts = Array.from(clubsHere.entries()).map(([c, n]) => `${c}×${n}`).join(', ');
    console.log(`  [${lbl}] ${buckets[i].length} students — ${parts}`);
    buckets[i].forEach((p, q) => {
      const slot1 = new Date(startMs + q * SLOT_MINUTES * 60000).toISOString();
      const slot2 = new Date(startMs + ROUND2_OFFSET_MS + q * SLOT_MINUTES * 60000).toISOString();
      updates.push({ id: p.id, table_id: t.id, scheduled_time: slot1, queue_position: q + 1, round_number: 1 });
      // Round 2: clone the row, same table & same offset, +1 hour, queue offset 1000 so it sorts after R1
      round2Inserts.push({
        team_name: p.team_name,
        student_names: p.student_names,
        coach_name: p.coach_name,
        parent_name: p.parent_name,
        parent_contact: p.parent_contact,
        club_name: p.club_name,
        date_of_birth: p.date_of_birth,
        category_id: p.category_id,
        table_id: t.id,
        scheduled_time: slot2,
        queue_position: 1000 + q + 1,
        live_status: 'Scheduled',
        notes: p.notes,
        round_number: 2,
      });
    });
  }
  if (peakMin > 60) overflowReport.push(`${cat.name}: peak table runs ${peakMin}min (${peakMin - 60} over the 60-min round)`);
}

console.log(`\n\nApplying ${updates.length} schedule updates…`);
let done = 0;
for (const u of updates) {
  const { id, ...patch } = u;
  const { error } = await supabase.from('passations').update(patch).eq('id', id);
  if (error) { console.error('update fail', id, error.message); continue; }
  done++;
  if (done % 50 === 0) console.log(`  ${done}/${updates.length}`);
}
console.log(`✓ ${done} round-1 rows updated`);

// Insert round 2 in chunks
const CHUNK = 100;
let r2Done = 0;
for (let i = 0; i < round2Inserts.length; i += CHUNK) {
  const slice = round2Inserts.slice(i, i + CHUNK);
  const { error } = await supabase.from('passations').insert(slice);
  if (error) { console.error('round-2 insert failed at', i, error.message); break; }
  r2Done += slice.length;
}
console.log(`✓ ${r2Done} round-2 rows inserted`);

if (overflowReport.length) {
  console.log('\n⚠ Categories that exceed the 60-min round window:');
  for (const r of overflowReport) console.log('  - ' + r);
} else {
  console.log('\n✓ All categories fit within the 60-min round window');
}
console.log('\n✅ Schedule generated for', EVENT_DATE);
