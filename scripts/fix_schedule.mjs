import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://kcdwxgziwaucaablarae.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjZHd4Z3ppd2F1Y2FhYmxhcmFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODE1MjQsImV4cCI6MjA5MTg1NzUyNH0.B0NyXhzJ08YQZkACamaXhfZmzTcgR_bwlb3pqmG2Y6Q'
);

const EVENT_DATE = '2026-05-31';
const INTERVAL   = 5; // minutes per slot

function toISO(hhmm) {
  return `${EVENT_DATE}T${hhmm}:00+00:00`;
}
function addMins(iso, mins) {
  return new Date(new Date(iso).getTime() + mins * 60000).toISOString().replace('.000Z', '+00:00');
}

// ── 1. DELETE DUPLICATES ──────────────────────────────────────────────────────
console.log('=== 1. Deleting duplicates ===');

const { error: e1 } = await supabase.from('passations').delete()
  .eq('id', '3797dde5-f06a-463f-95f9-154c36ba35ce'); // SERGE ZGHEIB dup
console.log('  SERGE ZGHEIB dup:', e1 ? e1.message : 'OK');

const { error: e2 } = await supabase.from('passations').delete()
  .eq('id', '1c1232e6-722c-46a5-89a5-12e3852fc894'); // Charbel Achkar MXI dup
console.log('  Charbel Achkar MXI dup:', e2 ? e2.message : 'OK');

// ── 2. LOOK UP TABLE IDs ──────────────────────────────────────────────────────
const { data: cats }      = await supabase.from('categories').select('id, name');
const getCat = pat        => cats.find(c => pat.test(c.name));
const mxsCatId            = getCat(/makex.*starter/i).id;
const soccerCatId         = getCat(/capelli.*soccer/i).id;
const mxiCatId            = getCat(/makex.*inspire/i).id;

const { data: allTables } = await supabase.from('tables').select('id, display_label, category_id').eq('active', true);
const getTable = (catId, label) => allTables.find(t => t.category_id === catId && t.display_label === label);

const mxsTable   = allTables.find(t => t.category_id === mxsCatId);
const soccer8    = getTable(soccerCatId, 'Table 8');
const soccer9    = getTable(soccerCatId, 'Table 9');
const mxiTable12 = getTable(mxiCatId, 'Table 12');
console.log('\nTables resolved — MXS:', mxsTable?.id, '| S8:', soccer8?.id, '| S9:', soccer9?.id);

// ── 3. SCHEDULE SERGE ZGHEIB R1 (Table 9, slot after 08:15) ──────────────────
console.log('\n=== 2. SERGE ZGHEIB R1 → 08:20 q:17 ===');
const { error: e3 } = await supabase.from('passations').update({
  scheduled_time: toISO('08:20'),
  queue_position: 17,
}).eq('id', '1ebecffd-a125-40f8-a09e-f1a8e7022d32');
console.log('  ', e3 ? e3.message : 'OK');

// ── 4. SCHEDULE CHARBEL ACHKAR MXI R1 (Table 12, slot after 08:05) ───────────
console.log('\n=== 3. Charbel Achkar MXI R1 → 08:10 q:15 ===');
const { error: e4 } = await supabase.from('passations').update({
  scheduled_time: toISO('08:10'),
  queue_position: 15,
}).eq('id', '4c981a34-bc43-47f8-b396-1bb4dcb6bca2');
console.log('  ', e4 ? e4.message : 'OK');

// ── 5. SCHEDULE MAKEX STARTER R1 (23 students, from 07:00) ───────────────────
console.log('\n=== 4. MakeX Starter R1 (23 students) ===');
const { data: mxsStudents } = await supabase.from('passations')
  .select('id, team_name, club_name')
  .eq('category_id', mxsCatId)
  .eq('round_number', 1)
  .is('scheduled_time', null)
  .order('club_name').order('team_name');

const mxsR1Start = toISO('07:00');
for (let i = 0; i < mxsStudents.length; i++) {
  const s = mxsStudents[i];
  const t = addMins(mxsR1Start, i * INTERVAL);
  const { error } = await supabase.from('passations').update({
    scheduled_time: t,
    queue_position: i + 1,
    table_id: mxsTable.id,
  }).eq('id', s.id);
  if (error) console.log('  ERROR', s.team_name, ':', error.message);
}
const mxsR1Last = addMins(mxsR1Start, (mxsStudents.length - 1) * INTERVAL);
console.log(`  Done — 07:00 → ${mxsR1Last.slice(11,16)} (${mxsStudents.length} students)`);

// ── 6. CREATE R2 ROWS ─────────────────────────────────────────────────────────
console.log('\n=== 5. Creating R2 rows ===');

async function createR2ForTable(catId, tableId, r2StartISO, label) {
  const { data: r1rows } = await supabase.from('passations')
    .select('*')
    .eq('category_id', catId)
    .eq('table_id', tableId)
    .eq('round_number', 1)
    .not('scheduled_time', 'is', null)
    .order('queue_position');

  const { data: existing } = await supabase.from('passations')
    .select('team_name, club_name')
    .eq('category_id', catId)
    .eq('table_id', tableId)
    .eq('round_number', 2);

  const existingKeys = new Set(existing.map(r => `${r.team_name}|${r.club_name}`.toLowerCase()));

  const toInsert = r1rows
    .filter(r => !existingKeys.has(`${r.team_name}|${r.club_name}`.toLowerCase()))
    .map((r, i) => ({
      team_name:      r.team_name,
      student_names:  r.student_names,
      club_name:      r.club_name,
      coach_name:     r.coach_name,
      parent_name:    r.parent_name,
      parent_contact: r.parent_contact,
      category_id:    r.category_id,
      table_id:       r.table_id,
      round_number:   2,
      queue_position: 1001 + i,
      scheduled_time: addMins(r2StartISO, i * INTERVAL),
      live_status:    'Scheduled',
      date_of_birth:  r.date_of_birth,
      notes:          r.notes,
    }));

  if (toInsert.length === 0) {
    console.log(`  ${label}: all R2 already exist`);
    return 0;
  }
  const { error } = await supabase.from('passations').insert(toInsert);
  if (error) {
    console.log(`  ${label} ERROR:`, error.message);
    return 0;
  }
  console.log(`  ${label}: ${toInsert.length} R2 rows → start ${r2StartISO.slice(11,16)}`);
  return toInsert.length;
}

// MakeX Starter R2: start at R1_last - INTERVAL
const mxsR2Start = addMins(mxsR1Last, -INTERVAL);
await createR2ForTable(mxsCatId, mxsTable.id, mxsR2Start, 'MakeX Starter');

// Soccer Table 8 R2: R1 last 08:15, R2 start 08:10
await createR2ForTable(soccerCatId, soccer8.id, toISO('08:10'), 'Soccer Table 8');

// Soccer Table 9 R2: R1 last now 08:20, R2 start 08:15
await createR2ForTable(soccerCatId, soccer9.id, toISO('08:15'), 'Soccer Table 9');

// Charbel Achkar MXI R2 (single row, appended at 09:10)
const { data: charbel } = await supabase.from('passations').select('*')
  .eq('id', '4c981a34-bc43-47f8-b396-1bb4dcb6bca2').single();
const { error: charbelR2Err } = await supabase.from('passations').insert({
  team_name: charbel.team_name, student_names: charbel.student_names,
  club_name: charbel.club_name, coach_name: charbel.coach_name,
  parent_name: charbel.parent_name, parent_contact: charbel.parent_contact,
  category_id: charbel.category_id, table_id: charbel.table_id,
  round_number: 2, queue_position: 1015,
  scheduled_time: toISO('09:10'),
  live_status: 'Scheduled', date_of_birth: charbel.date_of_birth,
});
console.log('  Charbel Achkar MXI R2:', charbelR2Err ? charbelR2Err.message : 'OK → 09:10 q:1015');

// ── 7. FINAL AUDIT ────────────────────────────────────────────────────────────
console.log('\n=== Final Audit ===');
const { data: fr1 }    = await supabase.from('passations').select('id').eq('round_number', 1);
const { data: fr2 }    = await supabase.from('passations').select('id').eq('round_number', 2);
const { data: unsched } = await supabase.from('passations').select('team_name, club_name')
  .eq('round_number', 1).is('scheduled_time', null);

console.log('Total R1:', fr1.length, '| Total R2:', fr2.length);
console.log('Unscheduled R1:', unsched.length === 0 ? '✅ none' : unsched.map(r => r.team_name).join(', '));

const { data: allR1 } = await supabase.from('passations').select('team_name, club_name, category_id').eq('round_number', 1);
const { data: allR2 } = await supabase.from('passations').select('team_name, club_name, category_id').eq('round_number', 2);
const r2set = new Set(allR2.map(r => `${r.team_name}|${r.club_name}|${r.category_id}`.toLowerCase()));
const missingR2 = allR1.filter(r => !r2set.has(`${r.team_name}|${r.club_name}|${r.category_id}`.toLowerCase()));
console.log('Missing R2:', missingR2.length === 0 ? '✅ none' : missingR2.map(r => r.team_name + ' (' + r.club_name + ')').join(', '));
