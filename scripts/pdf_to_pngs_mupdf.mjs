import * as mupdf from 'mupdf';
import fs from 'fs';

const SRC = process.argv[2];
const OUT = process.argv[3] || 'tmp_pdf_pages';
fs.mkdirSync(OUT, { recursive: true });

const data = fs.readFileSync(SRC);
const doc = mupdf.PDFDocument.openDocument(data, 'application/pdf');
const n = doc.countPages();
console.log('Pages:', n);

for (let i = 0; i < n; i++) {
  const page = doc.loadPage(i);
  const matrix = mupdf.Matrix.scale(2, 2); // 2x = ~144 dpi
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
  const png = pixmap.asPNG();
  fs.writeFileSync(`${OUT}/page-${String(i + 1).padStart(2, '0')}.png`, png);
  if ((i + 1) % 5 === 0 || i === n - 1) console.log(`  ${i + 1}/${n}`);
}
console.log('Done →', OUT);
