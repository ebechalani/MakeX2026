/**
 * Referee certificate generator — MakeX 2026 Lebanon
 *
 * Uses "This acknowledges that.pdf" (Canva design, 1 page) as the template.
 * Covers the placeholder name "Antonio Chahwane" with a white box and stamps
 * each referee's real name in the same position and style.
 *
 * Usage:
 *   node scripts/generate_referee_certificates.mjs
 *
 * Output:
 *   scripts/certificates/Referees/<First Last>.pdf   (one per referee)
 *   scripts/certificates/Referees/_all_referees.pdf  (merged)
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

// ── Referee list (from registration CSV, deduped + normalised) ────────────────
const REFEREES = [
  'Naim Yazbeck',
  'Nicolas El Dani',
  'Joe Abi Khalil',
  'Rita Daccache',
  'Imad Kabalan',
  'Giovan Edde',
  'Tarek Nassar',
  'Anthony Kassab',
  'Elio Rihani',
  'Fadi Ajib',
  'Chris Rouhana',
  'Naya Zouein',
  'Ray Geha',
  'Clarita Al Azzi',
  'Paul Rahal',
  'Tony Msaed',
  'Joy Hadchity',
  'Eddy Bader',
  'Samer Daccache',
  'Nicole Zib',
  'Edward Mouawad',
  'Ryan Abou Absi',
  'Anthony Al Alam',
  'Stephanie Hadchiti',
  'Shorouk Angilma',
  'Ibrahim Fattal',
  'Noel Abd Al Karim',
  'Ghady Mattar',
  'Ghadi El Hawa',
  'Nicolas Chami',
  'Charbel Geagea',
];

// ── Paths ─────────────────────────────────────────────────────────────────────
const TEMPLATE_PATH = 'C:/Users/eddy.bachaalany/Downloads/This acknowledges that.pdf';
const OUT_DIR       = path.resolve('scripts/certificates/Referees');

// ── Name placement (from pdfjs-dist text extraction) ─────────────────────────
// Original name "Antonio Chahwane": x=552.7  y=357.0  h=31.0
// We cover from x=545 to right margin with a white box, then redraw.
const NAME_X    = 552.7;
const NAME_Y    = 355.0;   // slight downward nudge for HelveticaBold baseline
const NAME_SIZE = 29;      // close match to original h=31
const NAME_MAX_W = 590;    // max pts before auto-shrink

const white = rgb(1,   1,   1);
const dark  = rgb(0.1, 0.1, 0.15);  // near-black matching the template

function sanitize(str) {
  return str.replace(/[<>:"/\\|?*]/g, '_').trim();
}

function fittingSize(text, font, nominal, maxW) {
  let size = nominal;
  while (size > 10 && font.widthOfTextAtSize(text, size) > maxW) size -= 0.5;
  return size;
}

// ── Main ──────────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });

const templateBytes = fs.readFileSync(TEMPLATE_PATH);
const allPages = [];

console.log(`Generating ${REFEREES.length} referee certificates…\n`);

for (const name of REFEREES) {
  // Fresh copy of the template for every referee
  const doc  = await PDFDocument.load(templateBytes);
  const page = doc.getPages()[0];
  const { width } = page.getSize();

  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // 1. Cover the placeholder name "Antonio Chahwane" (262 pts wide at size 29).
  //    Use a fixed width slightly larger than the placeholder so we don't spill
  //    into the right decorative border area.
  page.drawRectangle({
    x: NAME_X - 4,
    y: NAME_Y - 4,
    width:  280,
    height: NAME_SIZE + 12,
    color:  white,
  });

  // 2. Draw the referee's name in the same spot
  const size = fittingSize(name, fontBold, NAME_SIZE, NAME_MAX_W);
  page.drawText(name, {
    x:    NAME_X,
    y:    NAME_Y,
    size,
    font: fontBold,
    color: dark,
  });

  const pdfBytes = await doc.save();
  const fileName = `${sanitize(name)}.pdf`;
  fs.writeFileSync(path.join(OUT_DIR, fileName), pdfBytes);
  allPages.push(pdfBytes);

  console.log(`  ✓  ${name}`);
}

// ── Merged all-in-one PDF ─────────────────────────────────────────────────────
console.log('\nMerging into _all_referees.pdf…');
const merged = await PDFDocument.create();
for (const bytes of allPages) {
  const d   = await PDFDocument.load(bytes);
  const [p] = await merged.copyPages(d, [0]);
  merged.addPage(p);
}
fs.writeFileSync(path.join(OUT_DIR, '_all_referees.pdf'), await merged.save());

console.log(`\n✅  Done! ${REFEREES.length} certificates saved to scripts/certificates/Referees/`);
