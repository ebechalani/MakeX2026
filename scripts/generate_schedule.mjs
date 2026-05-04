// Generates round 1 + round 2 schedule for the May 31 venue date.
// - SportsWonderland: 14:00-15:00 round1, 15:00-16:00 round2
// - All others except MakeX Starter (Signal Rise): 10:00-11:00 round1, 11:00-12:00 round2
// - 5 min slots, students from same club placed consecutively on the same table.
// - Round 2 = NEW rows duplicating each round-1 row.
import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const EVENT_DATE = '2026-05-31'; // Sunday
const SLOT_MINUTES = 5;
const NOMINAL_ROUND_MINUTES = 60;
const NOMINAL_SLOTS = NOMINAL_ROUND_MINUTES / SLOT_MINUTES; // 12; just informational
const MAX_PER_TABLE_PER_ROUND = Infinity; // place everyone, overflow reported below

function startTimeFor(catName) {
  if (/sports\s*wonderland/i.test(catName)) return `${EVENT_DATE}T14:00:00`;
  return `${EVENT_DATE}T10:00:00`;
}
function isSkipped(catName) {
  // skip MakeX Starter / Signal Rise per user request — leave for next stage
  return /signal\s*rise/i.test(catName) || /makex\s*starter/i.test(catName);
}

const { data: cats } = await supabase.from('categories').select('*').order('name');
const { data: tables } = await supabase.from('tables').select('*').eq('active', true).order('table_number');
const { data: pass } = await supabase.from('passations').select('*');

console.log(`Categories: ${cats.length}, tables: ${tables.length}, passations: ${pass.length}`);

// First pass: clear ALL existing round-2 rows so we can regenerate cleanly
const { error: delR2 } = await supabase.from('passations').delete().eq('round_number', 2);
if (delR2) { console.error('Could not delete prior round 2 rows:', delR2.message); process.exit(1); }
console.log('✓ Cleared prior round 2 rows');

// Reload after delete
const { data: pass1 } = await supabase.from('passations').select('*');

const tablesByCat = new Map();
for (const t of tables) {
  if (!tablesByCat.has(t.category_id)) tablesByCat.set(t.category_id, []);
  tablesByCat.get(t.category_id).push(t);
}

const round2InsertRows = [];
const round1Updates = [];

for (const cat of cats) {
  if (isSkipped(cat.name)) {
    console.log(`\n⏭  Skip: ${cat.name}`);
    continue;
  }
  const startISO = startTimeFor(cat.name);
  const startMs = new Date(startISO).getTime();
  const round2StartMs = startMs + 60 * 60 * 1000;
  const catTables = (tablesByCat.get(cat.id) || []).slice().sort((a, b) => a.table_number - b.table_number);
  if (catTables.length === 0) { console.log(`\n⚠  ${cat.name} — no tables, skipping`); continue; }
  const catStudents = pass1.filter(p => p.category_id === cat.id);
  if (catStudents.length === 0) { console.log(`\n— ${cat.name} — no students`); continue; }

  // Group by club_name (preserves original distinct club_name)
  const clubMap = new Map();
  for (const p of catStudents) {
    const k = (p.club_name || '__nocl__').trim();
    if (!clubMap.has(k)) clubMap.set(k, []);
    clubMap.get(k).push(p);
  }
  // Sort clubs by size descending — bigger clubs first to balance better
  const clubGroups = Array.from(clubMap.values()).sort((a, b) => b.length - a.length);

  // Buckets per table
  const buckets = catTables.map(() => []);
  for (const club of clubGroups) {
    // Find table with fewest students that still has room for the full group
    // Prefer one that fits the entire club (avoids splitting); else split across least-loaded
    const remaining = club.slice();
    while (remaining.length > 0) {
      // pick least-loaded with capacity
      let best = -1;
      let bestSize = Infinity;
      for (let i = 0; i < buckets.length; i++) {
        if (buckets[i].length < MAX_PER_TABLE_PER_ROUND && buckets[i].length < bestSize) {
          best = i; bestSize = buckets[i].length;
        }
      }
      if (best === -1) {
        console.log(`  ⚠ ${cat.name}: ran out of capacity, ${remaining.length} students unscheduled`);
        break;
      }
      const room = MAX_PER_TABLE_PER_ROUND - buckets[best].length;
      buckets[best].push(...remaining.splice(0, room));
    }
  }

  // Compute peak duration: largest bucket × slot
  const peak = Math.max(...buckets.map(b => b.length));
  const peakMinutes = peak * SLOT_MINUTES;
  const overflowMin = Math.max(0, peakMinutes - NOMINAL_ROUND_MINUTES);
  const overflowFlag = overflowMin > 0 ? `   ⚠ peak table runs ${peakMinutes}min (${overflowMin}min over the 60-min round window)` : '';
  console.log(`\n→ ${cat.name} ${cat.age_range_label || ''} — ${catStudents.length} students across ${catTables.length} tables${overflowFlag}`);
  for (let i = 0; i < buckets.length; i++) {
    const t = catTables[i];
    const lbl = t.display_label || `Table ${t.table_number}`;
    console.log(`  [${lbl}] ${buckets[i].length} students:`);
    buckets[i].forEach((p, q) => {
      const slot1 = new Date(startMs + q * SLOT_MINUTES * 60000).toISOString();
      const slot2 = new Date(round2StartMs + q * SLOT_MINUTES * 60000).toISOString();
      const queuePos = q + 1;
      const queuePos2 = 1000 + queuePos; // round 2 always sorts after round 1 by queue_position
      console.log(`     ${queuePos.toString().padStart(2)} ${new Date(slot1).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}  ${p.team_name}  (${p.club_name || '—'})`);
      round1Updates.push({
        id: p.id,
        table_id: t.id,
        scheduled_time: slot1,
        queue_position: queuePos,
        round_number: 1,
      });
      // Round 2 = new row duplicating round 1
      round2InsertRows.push({
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
        queue_position: queuePos2,
        live_status: 'Scheduled',
        notes: p.notes,
        round_number: 2,
      });
    });
  }
}

console.log(`\n\nApplying ${round1Updates.length} round-1 updates and inserting ${round2InsertRows.length} round-2 rows…`);

// Apply round-1 updates in batches
let done = 0;
for (const u of round1Updates) {
  const { id, ...patch } = u;
  const { error } = await supabase.from('passations').update(patch).eq('id', id);
  if (error) { console.error('update failed for', id, error.message); continue; }
  done++;
  if (done % 50 === 0) console.log(`  updated ${done}/${round1Updates.length}`);
}
console.log(`✓ ${done} round-1 rows updated`);

// Insert round 2 in chunks
const CHUNK = 100;
for (let i = 0; i < round2InsertRows.length; i += CHUNK) {
  const slice = round2InsertRows.slice(i, i + CHUNK);
  const { error } = await supabase.from('passations').insert(slice);
  if (error) { console.error('round 2 insert failed at', i, error.message); break; }
}
console.log(`✓ ${round2InsertRows.length} round-2 rows inserted`);

console.log('\n✅ Schedule generated for', EVENT_DATE);
