import * as XLSX from 'xlsx';
import fs from 'fs';

const csv = fs.readFileSync('scripts/academy_credentials.csv', 'utf8');
const wb = XLSX.read(csv, { type: 'string' });
XLSX.writeFile(wb, 'scripts/academy_credentials.xlsx');

// Also write a semicolon-delimited variant + a sep-hint CSV for Excel
const rows = csv.trim().split('\n');
fs.writeFileSync('scripts/academy_credentials_excel.csv', 'sep=,\n' + csv);
console.log('Wrote academy_credentials.xlsx and academy_credentials_excel.csv');
