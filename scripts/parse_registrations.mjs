import XLSX from 'xlsx';
import fs from 'fs';

const FILE = 'C:/Users/eddy.bachaalany/Downloads/MakeX_reports_updated (1).xlsx';
const wb = XLSX.readFile(FILE);

const SKIP = new Set(['Teams_registration', 'Summary - By Age Category']);

const CATEGORY_MAP = {
  'Sports Wonderland - 4-5 manual':           { name: 'Sportswonderland',  age_range_label: '4–5 years old' },
  'Sports Wonderland 6-7 automatic':          { name: 'Sportswonderland',  age_range_label: '6–7 years old' },
  'Capelli Smart Logistics 8 - 9 automatic':  { name: 'Capelli Inspire',    age_range_label: '8–12 years old' },
  'Capelli Smart Logistics 10-12 automatic':  { name: 'Capelli Inspire',    age_range_label: '8–12 years old' },
  'Capelli Starter 13-15 automatic':          { name: 'Capelli Starter',    age_range_label: '13–15 years old' },
  'Capelli Football 8-12 manual':             { name: 'Capelli Soccer',     age_range_label: '' },
  'MakeX Inspire Code Courier 8-12 manual':   { name: 'MakeX Inspire',      age_range_label: '8–12 years old' },
  'MakeX Starter Signal Rise 8-13 auto+manual': { name: 'MakeX Starter',    age_range_label: '11–13 years old' },
};

// Normalize for matching (strip case, accents, extra spaces)
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

// Build coach lookup from Teams_registration: key=norm(school)|norm(team) → {coach_name, coach_phone, coach_email}
const regSheet = XLSX.utils.sheet_to_json(wb.Sheets['Teams_registration'], { header: 1, defval: '' });
const coachByKey = new Map();
const coachBySchool = new Map(); // fallback: most recent coach per school
for (let i = 1; i < regSheet.length; i++) {
  const r = regSheet[i];
  const school = String(r[1] || '').trim();
  const coach = String(r[2] || '').trim();
  const phone = String(r[3] || '').trim();
  const email = String(r[4] || '').trim();
  const team  = String(r[5] || '').trim();
  if (!school) continue;
  const info = { coach_name: coach, coach_phone: phone, coach_email: email };
  if (team) coachByKey.set(`${norm(school)}|${norm(team)}`, info);
  if (coach) coachBySchool.set(norm(school), info);
}

const records = [];
const unmapped = [];
const perCategory = {};

for (const sheetName of wb.SheetNames) {
  if (SKIP.has(sheetName)) continue;
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) continue;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const school = String(r[0] || '').trim();
    const teamOrStudent = String(r[1] || '').trim();
    const studentName = String(r[2] || '').trim();
    const compCat = String(r[7] || '').trim();
    if (!school && !studentName && !compCat) continue;
    if (!compCat || compCat === 'N/A' || compCat === 'Check manually') {
      unmapped.push({ sheet: sheetName, row: i + 1, reason: compCat || 'empty', data: r.slice(0, 8) });
      continue;
    }
    const mapped = CATEGORY_MAP[compCat];
    if (!mapped) { unmapped.push({ sheet: sheetName, row: i + 1, compCat }); continue; }

    const teamName = teamOrStudent || studentName;
    const key = `${norm(school)}|${norm(teamName)}`;
    const coach = coachByKey.get(key) || coachBySchool.get(norm(school)) || {};

    records.push({
      school,
      team_name: teamName,
      student_names: studentName,
      coach_name: coach.coach_name || '',
      parent_contact: [coach.coach_phone, coach.coach_email].filter(Boolean).join(' | '),
      competition_category: compCat,
      category_name: mapped.name,
      category_age: mapped.age_range_label,
    });
    const ck = `${mapped.name} | ${mapped.age_range_label}`;
    perCategory[ck] = (perCategory[ck] || 0) + 1;
  }
}

console.log(`Total records: ${records.length}`);
console.log(`Unmapped/skipped: ${unmapped.length}`);
const withCoach = records.filter(r => r.coach_name).length;
console.log(`With coach info: ${withCoach}/${records.length}`);
console.log('\nPer category:');
for (const [k, v] of Object.entries(perCategory).sort()) {
  console.log(`  ${k.padEnd(45)} ${v}`);
}

fs.writeFileSync('scripts/registrations.json', JSON.stringify(records, null, 2));
console.log(`\nWrote scripts/registrations.json (${records.length} records)`);
