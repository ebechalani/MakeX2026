import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

// ── Layout constants (keep in sync with scripts/generate_certificates.mjs) ───
const PAGE_W = 595.5;

const POS = {
  nameMain:  { y: 385.5, size: 18, maxSize: 18, minSize: 7 },
  category:  { y: 372.0, size: 12 },
  memberSig: { x: 140, y: 181.5, size: 11 },
  mentorSig: { x: 380, y: 181.5, size: 11 },
};

// White cover boxes — narrow width (just around text) but generous height
// so ascenders/descenders of Y / x / y are fully erased.
// Measured placeholder widths: YYYYY@17.9 ≈ 60pt, YYYYY@11.6 ≈ 39pt, xxxxx@11 ≈ 28pt.
// Centered placeholders → text x-range ≈ 268–328 (name) and 278–317 (category).
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

const TEMPLATE_PATH = path.join(process.cwd(), 'scripts', 'cert-template.pdf');

function sanitize(str: string) {
  return (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();
}

function centerX(text: string, font: import('pdf-lib').PDFFont, size: number) {
  const w = font.widthOfTextAtSize(text, size);
  return (PAGE_W - w) / 2;
}

function fittingSize(text: string, font: import('pdf-lib').PDFFont, nominalSize: number, maxWidth: number) {
  let size = nominalSize;
  while (size > 6 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ club: string; student: string }> },
) {
  const { club: clubRaw, student: studentRaw } = await params;
  const clubReq    = sanitize(decodeURIComponent(clubRaw));
  const studentReq = sanitize(decodeURIComponent(studentRaw).replace(/\.pdf$/i, ''));

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  // Look up the student by sanitized club + name match
  const [{ data: rows }, { data: cats }] = await Promise.all([
    sb.from('passations')
      .select('team_name, student_names, club_name, coach_name, category_id')
      .eq('round_number', 1),
    sb.from('categories').select('id, name'),
  ]);
  if (!rows) return new NextResponse('Database error', { status: 500 });

  const target = rows.find(r => {
    const nm = (r.student_names?.trim()) || r.team_name || '';
    return sanitize(r.club_name || '') === clubReq && sanitize(nm) === studentReq;
  });
  if (!target) return new NextResponse('Certificate not found', { status: 404 });

  const memberName = (target.student_names?.trim()) || target.team_name || '—';
  const mentorName = target.coach_name || '—';
  const catName    = cats?.find(c => c.id === target.category_id)?.name || '—';

  // Generate PDF
  const templateBytes = fs.readFileSync(TEMPLATE_PATH);
  const doc = await PDFDocument.load(templateBytes);
  const page = doc.getPages()[0];
  const fontBold   = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await doc.embedFont(StandardFonts.Helvetica);
  const dark  = rgb(0.1, 0.1, 0.1);
  const white = rgb(1, 1, 1);

  // 1. Cover placeholders
  for (const c of COVERS) {
    page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: white });
  }

  // 2. Student name (large bold centered)
  const nameMaxW = PAGE_W - 40;
  const nameSize = fittingSize(memberName, fontBold, POS.nameMain.maxSize, nameMaxW);
  page.drawText(memberName, {
    x: centerX(memberName, fontBold, nameSize),
    y: POS.nameMain.y, size: nameSize, font: fontBold, color: dark,
  });

  // 3. Category centered
  const catSize = POS.category.size;
  page.drawText(catName, {
    x: centerX(catName, fontNormal, catSize),
    y: POS.category.y, size: catSize, font: fontNormal, color: dark,
  });

  // 4. Member signature line
  const memSize = fittingSize(memberName, fontNormal, POS.memberSig.size, 160);
  page.drawText(memberName, {
    x: POS.memberSig.x, y: POS.memberSig.y,
    size: memSize, font: fontNormal, color: dark,
  });

  // 5. Mentor signature line
  const menSize = fittingSize(mentorName, fontNormal, POS.mentorSig.size, 175);
  page.drawText(mentorName, {
    x: POS.mentorSig.x, y: POS.mentorSig.y,
    size: menSize, font: fontNormal, color: dark,
  });

  const pdfBytes = await doc.save();
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${sanitize(memberName)}.pdf"`,
      // No caching — always reflect latest DB
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
