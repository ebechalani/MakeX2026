import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Fix mojibake (latin1 read as utf8 → "Ã©" should be "é")
function fixMojibake(s) {
  if (!s) return s;
  try {
    if (/Ã.|Â./.test(s)) {
      return Buffer.from(s, 'latin1').toString('utf8');
    }
  } catch {}
  return s;
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b([\p{L}])/gu, (m) => m.toUpperCase())
    .replace(/\bSscc\b/gi, 'SSCC').replace(/\bSjs\b/gi, 'SJS')
    .replace(/\bCcj\b/gi, 'CCJ').replace(/\bCnd\b/gi, 'CND')
    .replace(/\bIdea\b/gi, 'IDEA').replace(/\bSfm\b/gi, 'SFM')
    .replace(/\bEme\b/gi, 'EME');
}

function normalizeClub(s) {
  if (!s) return '';
  s = fixMojibake(s).replace(/\s+/g, ' ').trim();
  s = titleCase(s);
  // canonicalize known duplicates
  const canon = [
    [/^Lyc[eé]e Charlemagne$/i, 'Lycée Charlemagne'],
    [/^Lyc[eé]e Montaigne$/i, 'Lycée Montaigne'],
    [/^Sscc Kfardebiane?$/i, 'SSCC Kfardebian'],
    [/^Ecole Des Soeurs De La Croix\s*-?\s*Hrajel$/i, 'Ecole des Soeurs de la Croix - Hrajel'],
    [/^Ecole Saint Elie\s*-?\s*Sfm Zahle$/i, 'Ecole Saint Elie - SFM Zahle'],
    [/^Sainte Famille Francaise\s+Jounieh$/i, 'Sainte Famille Francaise Jounieh'],
    [/^Ingenious Cod(ing|eing) And Robotics Academy$/i, 'Ingenious Coding And Robotics Academy'],
    [/^Center Saint Michel \/ Idea$/i, 'Centre Saint Michel / IDEA'],
    [/^Centre Saint Michel ?\/ ?Idea$/i, 'Centre Saint Michel / IDEA'],
    [/^Idea$/i, 'Centre Saint Michel / IDEA'],
    [/^Mindcape Academy$/i, 'Mindscape Academy'],
    [/^Makassed Aisha School$/i, 'Makassed Aisha School'],
  ];
  for (const [re, rep] of canon) if (re.test(s)) return rep;
  return s;
}

function slug(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}
function randPwd() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let p = '';
  for (let i = 0; i < 7; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

// 1. Fetch passations + coach contact (from registrations.json)
const regs = JSON.parse(fs.readFileSync('scripts/registrations.json', 'utf8'));
const { data: pas, error: pErr } = await supabase.from('passations').select('id, club_name, coach_name, parent_contact');
if (pErr) throw pErr;
console.log(`Loaded ${pas.length} passations`);

// 2. Normalize and update club_name in passations
const updates = [];
for (const p of pas) {
  const norm = normalizeClub(p.club_name);
  if (norm !== p.club_name) updates.push({ id: p.id, club_name: norm });
}
console.log(`Normalizing ${updates.length} club names...`);
for (const u of updates) {
  const { error } = await supabase.from('passations').update({ club_name: u.club_name }).eq('id', u.id);
  if (error) throw error;
}

// 3. Build per-club info: most common coach + whatsapp from registrations.json
const clubInfo = new Map(); // norm club → {coach_name, whatsapp}
for (const r of regs) {
  const c = normalizeClub(r.school);
  if (!c) continue;
  const phone = (r.parent_contact || '').split('|')[0].trim();
  if (!clubInfo.has(c)) clubInfo.set(c, { coach_name: r.coach_name || '', whatsapp: phone });
  else {
    const cur = clubInfo.get(c);
    if (!cur.coach_name && r.coach_name) cur.coach_name = r.coach_name;
    if (!cur.whatsapp && phone) cur.whatsapp = phone;
  }
}

// 4. Distinct clubs from passations
const clubs = [...new Set(pas.map(p => normalizeClub(p.club_name)).filter(Boolean))].sort();
console.log(`Found ${clubs.length} distinct clubs`);

// 5. Seed academies
const usernames = new Set();
const rows = [];
for (const c of clubs) {
  let u = slug(c);
  let n = 2;
  while (usernames.has(u)) u = slug(c) + n++;
  usernames.add(u);
  const info = clubInfo.get(c) || {};
  rows.push({
    name: c,
    username: u,
    password: randPwd(),
    coach_name: info.coach_name || null,
    whatsapp_number: (info.whatsapp || '').replace(/[^0-9+]/g, '') || null,
  });
}

// Clear & insert (idempotent re-seed)
const { error: delErr } = await supabase.from('academies').delete().not('id', 'is', null);
if (delErr) throw delErr;
const { error: insErr } = await supabase.from('academies').insert(rows);
if (insErr) throw insErr;
console.log(`Seeded ${rows.length} academies`);

// CSV output
const csv = ['name,username,password,coach_name,whatsapp_number',
  ...rows.map(r => [r.name, r.username, r.password, r.coach_name || '', r.whatsapp_number || '']
    .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
fs.writeFileSync('scripts/academy_credentials.csv', csv);
console.log('Wrote scripts/academy_credentials.csv');
