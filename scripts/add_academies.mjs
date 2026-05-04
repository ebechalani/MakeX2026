import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

function randPwd() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let p = '';
  for (let i = 0; i < 7; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

const newAcademies = [
  { name: 'ESJ Capucins Batroun', username: 'esj-capucins-batroun', password: randPwd(), coach_name: 'Rawi Noun', whatsapp_number: '81326235' },
];

for (const a of newAcademies) {
  const { data: existing } = await supabase.from('academies').select('id').eq('username', a.username).maybeSingle();
  if (existing) {
    console.log(`Skip (exists): ${a.name}`);
    continue;
  }
  const { error } = await supabase.from('academies').insert(a);
  if (error) { console.error(`Failed ${a.name}:`, error.message); continue; }
  console.log(`Added: ${a.name} → ${a.username} / ${a.password}`);
}

// Append to credentials CSV
const csvPath = 'scripts/academy_credentials.csv';
const existing = fs.readFileSync(csvPath, 'utf8');
const newRows = newAcademies.map(a =>
  [a.name, a.username, a.password, a.coach_name || '', a.whatsapp_number || '']
    .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
).join('\n');
fs.writeFileSync(csvPath, existing.trimEnd() + '\n' + newRows + '\n');
console.log('Appended to academy_credentials.csv');
