/**
 * Certificate generator — MakeX 2026 Lebanon
 *
 * For every R1 student, stamps:
 *   YYYYY (main)   → student full name        (large, centered)
 *   YYYYY (sub)    → category name            (smaller, centered)
 *   xxxxx (left)   → student name (member)    (small, left)
 *   xxxxx (right)  → coach/mentor name        (small, right)
 *
 * Then uploads each PDF to Supabase Storage bucket "certificates".
 *
 * Outputs: scripts/certificates/<ClubName>/<StudentName>.pdf
 * Also:    scripts/certificates/_all_certificates.pdf  (merged)
 *
 * Usage:
 *   node scripts/generate_certificates.mjs
 *
 * Prerequisite: run scripts/setup_certificates.sql in Supabase first.
 */

import { createClient } from '@supabase/supabase-js';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://kcdwxgziwaucaablarae.supabase.co';
const SUPABASE_KEY  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjZHd4Z3ppd2F1Y2FhYmxhcmFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODE1MjQsImV4cCI6MjA5MTg1NzUyNH0.B0NyXhzJ08YQZkACamaXhfZmzTcgR_bwlb3pqmG2Y6Q';
const TEMPLATE_PATH = path.resolve('scripts/cert-template.pdf');
const OUT_DIR       = path.resolve('scripts/certificates');
const PUBLIC_DIR    = path.resolve('public/certificates');

// Page dimensions (A4 in pts)
const PAGE_W = 595.5;
const PAGE_H = 842.25;

// ── Placeholder positions from pdfplumber (y_top = distance from top of page) ─
// Convert to pdf-lib y (bottom-left origin): y_pdf = PAGE_H - y_top - font_size
//
//  YYYYY name:     y_top=438.7, size=17.9  → y_bottom=385.65, y_top_pdf=403.55
//  YYYYY category: y_top=458.6, size=11.6  → y_bottom=372.05, y_top_pdf=383.65
//  xxxxx member:   y_top=649.6, size=11    → y_bottom=181.65, y_top_pdf=192.65  x≈208
//  xxxxx mentor:   y_top=649.1, size=11    → y_bottom=182.15, y_top_pdf=193.15  x≈388

const POS = {
  // Student full name — large bold, centered
  nameMain: { y: 385.5, size: 18, maxSize: 18, minSize: 7, center: true },
  // Category — smaller, centered
  category: { y: 372.0, size: 12, center: true },
  // Team Member signature name (left column)
  memberSig: { x: 140, y: 181.5, size: 11 },
  // Mentor signature name (right column)
  mentorSig: { x: 380, y: 181.5, size: 11 },
};

// White cover boxes — narrow width (just around text) but generous height
// so ascenders/descenders are fully erased.
const COVERS = [
  // YYYYY name (centered ~268-328)
  { x: 260, y: 375, w: 80, h: 42 },
  // YYYYY category (centered ~278-317)
  { x: 268, y: 362, w: 62, h: 33 },
  // xxxxx member (x ≈ 208-236)
  { x: 200, y: 173, w: 44, h: 30 },
  // xxxxx mentor (x ≈ 388-416)
  { x: 380, y: 173, w: 44, h: 30 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitize(str) {
  return (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();
}

function centerX(text, font, size) {
  const w = font.widthOfTextAtSize(text, size);
  return (PAGE_W - w) / 2;
}

/** Auto-shrink font size until text fits within maxWidth pts */
function fittingSize(text, font, nominalSize, maxWidth) {
  let size = nominalSize;
  while (size > 6 && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }
  return size;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Fetch ALL R1 students (all categories including MakeX Starter)
const { data: rows, error } = await supabase
  .from('passations')
  .select('team_name, student_names, club_name, coach_name, category_id')
  .eq('round_number', 1)
  .order('club_name')
  .order('team_name');

if (error) { console.error('DB error:', error.message); process.exit(1); }

const { data: cats } = await supabase.from('categories').select('id, name');
const catMap = Object.fromEntries(cats.map(c => [c.id, c.name]));

const students = rows;

console.log(`Generating ${students.length} certificates…\n`);

// Load template bytes once
const templateBytes = fs.readFileSync(TEMPLATE_PATH);

// Ensure output dirs
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const allPages = [];  // collect for merged PDF

for (const stu of students) {
  // Use student_names (full legal name) — fall back to team_name for display
  const memberName  = (stu.student_names && stu.student_names.trim()) ? stu.student_names.trim() : (stu.team_name || '—');
  const mentorName  = stu.coach_name || '—';
  const categoryName = catMap[stu.category_id] || '—';
  const clubName    = sanitize(stu.club_name || 'Unknown');

  // Load a fresh copy of the template for each certificate
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page   = pdfDoc.getPages()[0];

  // Embed fonts
  const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const dark  = rgb(0.1, 0.1, 0.1);
  const white = rgb(1, 1, 1);

  // ── 1. Cover placeholders with white boxes ────────────────────────────────
  for (const c of COVERS) {
    page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: white });
  }

  // ── 2. Draw student full name (large, centered, bold, auto-shrink) ─────────
  const nameMaxW = PAGE_W - 40;  // 20pt margin each side
  const nameSize = fittingSize(memberName, fontBold, POS.nameMain.maxSize, nameMaxW);
  const nameX    = centerX(memberName, fontBold, nameSize);
  page.drawText(memberName, {
    x: nameX, y: POS.nameMain.y,
    size: nameSize, font: fontBold, color: dark,
  });

  // ── 3. Draw category (smaller, centered) ──────────────────────────────────
  const catSize = POS.category.size;
  const catX    = centerX(categoryName, fontNormal, catSize);
  page.drawText(categoryName, {
    x: catX, y: POS.category.y,
    size: catSize, font: fontNormal, color: dark,
  });

  // ── 4. Draw Team Member signature name (left) ─────────────────────────────
  const memSize = fittingSize(memberName, fontNormal, POS.memberSig.size, 160);
  page.drawText(memberName, {
    x: POS.memberSig.x, y: POS.memberSig.y,
    size: memSize, font: fontNormal, color: dark,
  });

  // ── 5. Draw Mentor signature name (right) ─────────────────────────────────
  const menSize = fittingSize(mentorName, fontNormal, POS.mentorSig.size, 175);
  page.drawText(mentorName, {
    x: POS.mentorSig.x, y: POS.mentorSig.y,
    size: menSize, font: fontNormal, color: dark,
  });

  // ── 6. Save individual certificate ────────────────────────────────────────
  const clubDir   = path.join(OUT_DIR, clubName);
  const pubClubDir = path.join(PUBLIC_DIR, clubName);
  fs.mkdirSync(clubDir, { recursive: true });
  fs.mkdirSync(pubClubDir, { recursive: true });

  const fileName  = `${sanitize(memberName)}.pdf`;
  const certBytes = await pdfDoc.save();
  fs.writeFileSync(path.join(clubDir, fileName), certBytes);
  fs.writeFileSync(path.join(pubClubDir, fileName), certBytes);
  allPages.push(certBytes);

  console.log(`  ✓  ${memberName.padEnd(32)} | ${categoryName.padEnd(25)} | ${mentorName}`);
}

// ── Merge all into one PDF ────────────────────────────────────────────────────
console.log('\nMerging all into _all_certificates.pdf…');
const merged = await PDFDocument.create();
for (const bytes of allPages) {
  const doc  = await PDFDocument.load(bytes);
  const [pg] = await merged.copyPages(doc, [0]);
  merged.addPage(pg);
}
const mergedPath = path.join(OUT_DIR, '_all_certificates.pdf');
fs.writeFileSync(mergedPath, await merged.save());
console.log('  ✓  merged PDF saved');

console.log(`\n✅ Done!`);
console.log(`   Generated : ${students.length} certificates`);
console.log(`   Served at : public/certificates/<Club>/<Name>.pdf  →  /certificates/<Club>/<Name>.pdf`);
console.log(`   All-in-one: scripts/certificates/_all_certificates.pdf`);
