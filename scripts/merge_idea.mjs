import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

// 1. Find the canonical IDEA academy (the existing one we want to keep)
const { data: acads, error: aErr } = await supabase.from('academies').select('*');
if (aErr) throw aErr;
const ideaCandidates = acads.filter(a => /idea/i.test(a.name));
console.log('IDEA-related academies:');
for (const a of ideaCandidates) console.log(`  - "${a.name}"  (username: ${a.username})`);

// Choose canonical: prefer the one with "Saint Michel" / longer / matches the existing assigned name
const canonical = ideaCandidates.find(a => /saint\s*michel/i.test(a.name))
  || ideaCandidates.find(a => /centre/i.test(a.name))
  || ideaCandidates[0];
if (!canonical) { console.error('No IDEA academy found'); process.exit(1); }
console.log(`\nCanonical academy: "${canonical.name}"`);

// 2. Find all distinct club_name values in passations that look like IDEA
const { data: pasAll, error: pErr } = await supabase.from('passations').select('id, team_name, club_name');
if (pErr) throw pErr;

const ideaClubNames = new Set();
for (const p of pasAll) {
  if (p.club_name && /idea|saint\s*michel/i.test(p.club_name)) ideaClubNames.add(p.club_name);
}
console.log('\nClub-name values in passations that look like IDEA:');
for (const n of ideaClubNames) console.log(`  - "${n}"`);

// 3. Normalize every matching record's club_name to the canonical academy name
let changed = 0, skipped = 0;
for (const p of pasAll) {
  if (!p.club_name) continue;
  if (!ideaClubNames.has(p.club_name)) continue;
  if (p.club_name === canonical.name) { skipped++; continue; }
  const { error } = await supabase.from('passations').update({ club_name: canonical.name }).eq('id', p.id);
  if (error) { console.error('Update failed:', p.team_name, error.message); continue; }
  changed++;
}
console.log(`\nUpdated ${changed} passation(s); ${skipped} already canonical.`);

// 4. Delete duplicate IDEA academies (other than canonical) so login is unambiguous
for (const a of ideaCandidates) {
  if (a.id === canonical.id) continue;
  // Only delete if no pending_changes still reference it; if so, reassign them
  const { data: pcs } = await supabase.from('pending_changes').select('id').eq('academy_id', a.id);
  if (pcs && pcs.length) {
    await supabase.from('pending_changes').update({ academy_id: canonical.id }).eq('academy_id', a.id);
    console.log(`Reassigned ${pcs.length} pending_changes from "${a.name}" → canonical`);
  }
  const { error: dErr } = await supabase.from('academies').delete().eq('id', a.id);
  if (dErr) { console.error(`Failed to delete "${a.name}":`, dErr.message); continue; }
  console.log(`Deleted duplicate academy: "${a.name}" (${a.username})`);
}

console.log('\nDone. Login with the canonical credentials.');
