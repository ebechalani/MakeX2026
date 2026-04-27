import XLSX from 'xlsx';
const wb = XLSX.readFile('C:/Users/eddy.bachaalany/Downloads/MakeX_reports_updated (1).xlsx');
console.log('Sheets:', wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log(`\n=== ${name} (${json.length} rows) ===`);
  json.slice(0, 5).forEach((r, i) => console.log(i, JSON.stringify(r)));
}
