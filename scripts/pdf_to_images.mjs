import fs from 'fs';
import path from 'path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const SRC = process.argv[2];
const OUT = process.argv[3] || 'tmp_pdf_pages';
if (!SRC) { console.error('usage: node pdf_to_images.mjs <pdf> [outDir]'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

class NodeCanvasFactory {
  create(w, h) { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; }
  reset(c, w, h) { c.canvas.width = w; c.canvas.height = h; }
  destroy(c) { c.canvas.width = 0; c.canvas.height = 0; }
}

const data = new Uint8Array(fs.readFileSync(SRC));
const doc = await pdfjs.getDocument({ data, canvasFactory: new NodeCanvasFactory() }).promise;
console.log('Pages:', doc.numPages);

for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport, canvasFactory: new NodeCanvasFactory() }).promise;
  const buf = canvas.toBuffer('image/png');
  const file = path.join(OUT, `page-${String(i).padStart(2, '0')}.png`);
  fs.writeFileSync(file, buf);
  if (i % 5 === 0 || i === doc.numPages) console.log(`  rendered ${i}/${doc.numPages}`);
}
console.log('Done →', OUT);
