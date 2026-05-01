import XLSX from 'xlsx';
const wb = XLSX.readFile('C:/Users/eddy.bachaalany/Downloads/MakeX_reports_updated (1).xlsx');
console.log('Sheets:', wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  if (!rows.length) continue;
  const cols = Object.keys(rows[0]);
  const dobCols = cols.filter(c => /birth|dob|date/i.test(c));
  if (dobCols.length || name === 'Teams_registration') {
    console.log(`\n--- ${name} (${rows.length} rows) ---`);
    console.log('All cols:', cols);
    console.log('DOB-like cols:', dobCols);
    if (dobCols.length) {
      console.log('Sample value:', rows[0][dobCols[0]]);
      console.log('Row sample:', JSON.stringify(rows[0], null, 2).slice(0, 800));
    }
  }
}
