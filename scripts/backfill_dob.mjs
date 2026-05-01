import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const wb = XLSX.readFile('C:/Users/eddy.bachaalany/Downloads/MakeX_reports_updated (1).xlsx');

function fixMojibake(s) {
  if (!s) return s;
  if (/Ã.|Â./.test(s)) {
    try { return Buffer.from(s, 'latin1').toString('utf8'); } catch { return s; }
  }
  return s;
}

function norm(s) {
  if (!s) return '';
  return fixMojibake(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Parse DD/MM/YYYY or D/M/YYYY → ISO YYYY-MM-DD
function parseDOB(s) {
  if (!s || s === 'N/A') return null;
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const yr = y.length === 2 ? '20' + y : y;
  const iso = `${yr}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  if (isNaN(new Date(iso).getTime())) return null;
  return iso;
}

// Build name → DOB map across all per-club sheets
const nameToDob = new Map(); // norm(student_name) → dob
const teamToDob = new Map(); // norm(team) → dob
let totalRowsScanned = 0;

const skipSheets = new Set(['Teams_registration', 'Summary - By Age Category']);
for (const name of wb.SheetNames) {
  if (skipSheets.has(name)) continue;
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  for (const r of rows) {
    const dob = parseDOB(r['Date of Birth']);
    if (!dob) continue;
    const studentKey = norm(r['Student Name']);
    const teamKey = norm(r['Student/Team']);
    if (studentKey) nameToDob.set(studentKey, dob);
    if (teamKey) teamToDob.set(teamKey, dob);
    totalRowsScanned++;
  }
}
console.log(`Scanned ${totalRowsScanned} rows; ${nameToDob.size} student-name keys, ${teamToDob.size} team keys`);

const { data: pas, error } = await supabase.from('passations').select('id, team_name, student_names, date_of_birth, club_name');
if (error) throw error;

let matched = 0, alreadySet = 0, missed = 0;
const missedRows = [];
for (const p of pas) {
  if (p.date_of_birth) { alreadySet++; continue; }
  const candidates = [
    norm(p.student_names),
    norm(p.team_name),
  ].filter(Boolean);
  let dob = null;
  for (const k of candidates) {
    if (nameToDob.has(k)) { dob = nameToDob.get(k); break; }
    if (teamToDob.has(k)) { dob = teamToDob.get(k); break; }
  }
  if (!dob) {
    // partial match
    for (const k of candidates) {
      for (const [nk, ndob] of nameToDob) {
        if (nk.includes(k) || k.includes(nk)) { dob = ndob; break; }
      }
      if (dob) break;
    }
  }
  if (dob) {
    const { error: upErr } = await supabase.from('passations').update({ date_of_birth: dob }).eq('id', p.id);
    if (upErr) { console.error('Update failed:', p.team_name, upErr.message); continue; }
    matched++;
  } else {
    missed++;
    missedRows.push({ team: p.team_name, student: p.student_names, club: p.club_name });
  }
}

console.log(`\nMatched & updated: ${matched}`);
console.log(`Already had DOB:   ${alreadySet}`);
console.log(`No match:          ${missed}`);
if (missedRows.length) {
  console.log('\nUnmatched (first 30):');
  for (const r of missedRows.slice(0, 30)) console.log(' -', r.club, '|', r.team, '|', r.student);
}
