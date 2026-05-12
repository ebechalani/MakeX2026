// One-off patch: slot the 2 Futurebot students (Charbel Rizk, Ely Ibrahim) into
// the 07:20 and 07:25 gap on MakeX Inspire Table 4, replacing Joseph Zaarour
// and Maria Zaarour in R2 with them at 08:20/08:25.
import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const TABLE_ID = 'a73eb7e1-1698-42eb-ba35-adcefffe2227';

// 1) Read everything on this table
const { data: all } = await s.from('passations').select('*').eq('table_id', TABLE_ID).order('round_number').order('queue_position');
const r1 = all.filter(p => p.round_number === 1);
const r2 = all.filter(p => p.round_number === 2);
const rizk = r1.find(p => p.team_name === 'Charbel Rizk' && p.club_name === 'Futurebot Academy');
const ely  = r1.find(p => p.team_name === 'Ely Ibrahim'  && p.club_name === 'Futurebot Academy');
if (!rizk || !ely) throw new Error('New Futurebot students not found on this table');
const joseph = r2.find(p => p.team_name === 'Joseph Zaarour');
const maria  = r2.find(p => p.team_name === 'Maria Zaarour');
if (!joseph || !maria) throw new Error('Zaarour R2 rows not found');

console.log('Found new R1 students:', rizk.team_name, '+', ely.team_name);
console.log('Found Zaarour R2 rows :', joseph.team_name, '+', maria.team_name);

// 2) Compute the canonical time for each q in R1 (5-min slots starting at the earliest existing row)
const r1Scheduled = r1.filter(p => p.scheduled_time && p.queue_position > 0).sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time));
const r1Start = new Date(r1Scheduled[0].scheduled_time);
console.log('R1 start time:', r1Start.toISOString());
function r1Slot(qOneBased) { return new Date(r1Start.getTime() + (qOneBased - 1) * 5 * 60_000).toISOString(); }
function r2Slot(qOneBased) { return new Date(r1Start.getTime() + 60 * 60_000 + (qOneBased - 1) * 5 * 60_000).toISOString(); }

// 3) Plan: re-number all R1 to 1..14 in time-order, slotting Futurebot at 5 & 6
const r1Ordered = [
  ...r1Scheduled.slice(0, 4),                  // q=1..4 Saint Elie (07:00..07:15)
  rizk,                                         // q=5  Charbel Rizk (07:20)
  ely,                                          // q=6  Ely Ibrahim   (07:25)
  ...r1Scheduled.slice(4),                      // q=7..14 the remaining 8 Saint Elie
];
console.log('\nNew R1 order:');
for (let i = 0; i < r1Ordered.length; i++) {
  const q = i + 1;
  console.log('  q=' + q, '|', r1Slot(q).slice(11, 16) + 'Z', '|', r1Ordered[i].team_name);
}

// 4) Apply R1 updates
console.log('\nApplying R1 updates...');
for (let i = 0; i < r1Ordered.length; i++) {
  const q = i + 1;
  const target = { queue_position: q, scheduled_time: r1Slot(q), updated_at: new Date().toISOString() };
  const { error } = await s.from('passations').update(target).eq('id', r1Ordered[i].id);
  if (error) console.error('  R1 update failed', r1Ordered[i].team_name, error.message);
  else console.log('  ✓', r1Ordered[i].team_name, '→ q=' + q);
}

// 5) Delete the Zaarour R2 orphans
console.log('\nDeleting Zaarour R2 rows...');
const { error: delErr } = await s.from('passations').delete().in('id', [joseph.id, maria.id]);
if (delErr) throw delErr;
console.log('  ✓ deleted Joseph + Maria Zaarour R2');

// 6) Insert new R2 rows for Rizk + Ely (at q=1005, 1006 — same slots Zaarour had)
console.log('\nInserting R2 rows for new Futurebot students...');
const r2NewRows = [
  { ...stripId(rizk), round_number: 2, queue_position: 1005, scheduled_time: r2Slot(5),  live_status: 'Scheduled' },
  { ...stripId(ely),  round_number: 2, queue_position: 1006, scheduled_time: r2Slot(6),  live_status: 'Scheduled' },
];
const { error: insErr } = await s.from('passations').insert(r2NewRows);
if (insErr) throw insErr;
console.log('  ✓ inserted Charbel Rizk R2 (q=1005, 08:20) + Ely Ibrahim R2 (q=1006, 08:25)');

console.log('\n✅ Patch complete.');

function stripId(row) {
  const { id, created_at, updated_at, score, time_seconds, judge_name, signature_image, finalized_at, final_result_status, delay_count, ...rest } = row;
  return rest;
}
