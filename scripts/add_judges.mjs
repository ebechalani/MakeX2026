// Seed 17 judges with random 7-char passwords. Outputs CSV with credentials.
// Run via SQL editor (authenticated role) — anon cannot insert into judges.
// USAGE: paste this into a Node script connected with the SUPABASE_SERVICE_ROLE_KEY,
// OR generate the INSERT SQL below and run it in the SQL editor.
import fs from 'fs';

function randPwd() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let p = '';
  for (let i = 0; i < 7; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

const rows = [];
for (let i = 1; i <= 17; i++) {
  rows.push({
    name: `Judge ${i}`,
    username: `judge-${i}`,
    password: randPwd(),
  });
}

// Output the credentials CSV (one row per judge)
const csv = ['name,username,password',
  ...rows.map(r => `"${r.name}","${r.username}","${r.password}"`)
].join('\n');
fs.writeFileSync('scripts/judge_credentials.csv', csv);
console.log('Wrote scripts/judge_credentials.csv');

// Output the SQL to paste into the Supabase SQL editor
const sqlRows = rows.map(r =>
  `('${r.name.replace(/'/g, "''")}', '${r.username}', extensions.crypt('${r.password}', extensions.gen_salt('bf', 10)))`
).join(',\n  ');
const sql = `-- Run this in the Supabase SQL editor (authenticated role bypasses RLS)
INSERT INTO judges (name, username, password_hash) VALUES
  ${sqlRows};`;
fs.writeFileSync('scripts/seed_judges.sql', sql);
console.log('Wrote scripts/seed_judges.sql — paste this into the Supabase SQL editor');
