import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { SCHOOL_NAMES } from '@/lib/ranking';

// ── Same layout constants as participation cert ────────────────────────────────
const PAGE_W = 595.5;

const POS = {
  nameMain:  { y: 386.5, size: 18, maxSize: 18, minSize: 7 },
  category:  { y: 372.0, size: 12 },
  clubLine:  { y: 357.0, size: 11 },   // club / school name + type below category
  rankLine:  { y: 500.0, size: 23 },   // replaces "Certificate of Participation" — centre of cert body
  memberSig: { x: 140, y: 181.5, size: 11 },
  mentorSig: { x: 380, y: 181.5, size: 11 },
};

// White cover boxes
const COVERS_BASE = [
  { x: 170, y: 375, w: 260, h: 42 },   // name area (back to participation-cert height)
  { x: 210, y: 362, w: 180, h: 33 },   // category
  { x: 170, y: 347, w: 260, h: 20 },   // club / school name line
  { x: 50,  y: 440, w: 495, h: 200 },  // cover "Certificate of Participation" template text
  { x: 195, y: 173, w: 60,  h: 30 },   // member sig
  { x: 370, y: 173, w: 60,  h: 30 },   // mentor sig
];

// ── School / Club type helper (mirrors src/lib/ranking.ts) ────────────────────
function orgType(clubName: string): 'School' | 'Club' {
  if (SCHOOL_NAMES.has(clubName)) return 'School';
  const norm = clubName.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  for (const s of SCHOOL_NAMES) {
    if (s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase() === norm) return 'School';
  }
  return 'Club';
}

const RANK_LABELS: Record<number, string> = {
  1: '1st Place',
  2: '2nd Place',
  3: '3rd Place',
  4: '4th Place',
  5: '5th Place',
};

const TEMPLATE_PATH    = path.join(process.cwd(), 'scripts', 'cert-template.pdf');
const NAT_ORG_SIG_PATH = path.join(process.cwd(), 'scripts', 'national_organiser_signature.png');
const NAT_ORG_LABEL    = 'National Organiser';
const NAT_ORG          = { x: 440, y: 70, w: 100, labelY: 55, labelSize: 9 };

function sanitize(str: string) {
  return (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();
}
function centerX(text: string, font: import('pdf-lib').PDFFont, size: number) {
  return (PAGE_W - font.widthOfTextAtSize(text, size)) / 2;
}
function fittingSize(text: string, font: import('pdf-lib').PDFFont, nominal: number, maxW: number) {
  let s = nominal;
  while (s > 6 && font.widthOfTextAtSize(text, s) > maxW) s -= 0.5;
  return s;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ club: string; student: string; rank: string }> },
) {
  const { club: clubRaw, student: studentRaw, rank: rankRaw } = await params;
  const clubReq    = sanitize(decodeURIComponent(clubRaw));
  const studentReq = sanitize(decodeURIComponent(studentRaw).replace(/\.pdf$/i, ''));
  const rankNum    = parseInt(rankRaw, 10);

  if (isNaN(rankNum) || rankNum < 1 || rankNum > 5) {
    return new NextResponse('Invalid rank', { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const [{ data: rows }, { data: cats }] = await Promise.all([
    sb.from('passations').select('team_name, student_names, club_name, coach_name, category_id').eq('round_number', 1),
    sb.from('categories').select('id, name'),
  ]);
  if (!rows) return new NextResponse('Database error', { status: 500 });

  const target = rows.find(r => {
    const nm = (r.student_names?.trim()) || r.team_name || '';
    return sanitize(r.club_name || '') === clubReq && sanitize(nm) === studentReq;
  });
  if (!target) return new NextResponse('Certificate not found', { status: 404 });

  const memberName  = (target.student_names?.trim()) || target.team_name || '—';
  const mentorName  = target.coach_name || '—';
  const catName     = cats?.find(c => c.id === target.category_id)?.name || '—';
  const rankLabel   = RANK_LABELS[rankNum] ?? `${rankNum}th Place`;
  const clubDisplay = target.club_name || clubReq;
  const typeLabel   = orgType(target.club_name || '');
  const clubLine    = `${clubDisplay} · ${typeLabel}`;

  // Generate PDF
  const templateBytes = fs.readFileSync(TEMPLATE_PATH);
  const doc  = await PDFDocument.load(templateBytes);
  const page = doc.getPages()[0];
  const fontBold   = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await doc.embedFont(StandardFonts.Helvetica);
  const dark  = rgb(0.1, 0.1, 0.1);
  const white = rgb(1, 1, 1);
  const red   = rgb(0.86, 0.08, 0.08);

  // 1. Cover placeholders
  for (const c of COVERS_BASE) {
    page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: white });
  }

  // 2. Student name (large bold centered)
  const nameSize = fittingSize(memberName, fontBold, POS.nameMain.maxSize, PAGE_W - 40);
  page.drawText(memberName, {
    x: centerX(memberName, fontBold, nameSize),
    y: POS.nameMain.y, size: nameSize, font: fontBold, color: dark,
  });

  // 3. Category centered
  page.drawText(catName, {
    x: centerX(catName, fontNormal, POS.category.size),
    y: POS.category.y, size: POS.category.size, font: fontNormal, color: dark,
  });

  // 4. Club / School name + type (e.g. "RoboHolic · Club")
  const clubLineSize = fittingSize(clubLine, fontNormal, POS.clubLine.size, PAGE_W - 40);
  page.drawText(clubLine, {
    x: centerX(clubLine, fontNormal, clubLineSize),
    y: POS.clubLine.y, size: clubLineSize, font: fontNormal, color: dark,
  });

  // 5. Rank — large, bold, red, centred between name section and signature line
  const rankSize = fittingSize(rankLabel, fontBold, POS.rankLine.size, PAGE_W - 80);
  page.drawText(rankLabel, {
    x: centerX(rankLabel, fontBold, rankSize),
    y: POS.rankLine.y, size: rankSize, font: fontBold, color: red,
  });

  // 6. Member signature line
  const memSize = fittingSize(memberName, fontNormal, POS.memberSig.size, 160);
  page.drawText(memberName, { x: POS.memberSig.x, y: POS.memberSig.y, size: memSize, font: fontNormal, color: dark });

  // 7. Mentor signature line
  const menSize = fittingSize(mentorName, fontNormal, POS.mentorSig.size, 175);
  page.drawText(mentorName, { x: POS.mentorSig.x, y: POS.mentorSig.y, size: menSize, font: fontNormal, color: dark });

  // 8. National Organiser signature image
  if (fs.existsSync(NAT_ORG_SIG_PATH)) {
    const sigBytes = fs.readFileSync(NAT_ORG_SIG_PATH);
    const sigImg   = await doc.embedPng(sigBytes);
    const h        = NAT_ORG.w * (sigImg.height / sigImg.width);
    page.drawImage(sigImg, { x: NAT_ORG.x, y: NAT_ORG.y, width: NAT_ORG.w, height: h });
    const labelW = fontNormal.widthOfTextAtSize(NAT_ORG_LABEL, NAT_ORG.labelSize);
    page.drawText(NAT_ORG_LABEL, {
      x: NAT_ORG.x + (NAT_ORG.w - labelW) / 2, y: NAT_ORG.labelY,
      size: NAT_ORG.labelSize, font: fontNormal, color: dark,
    });
  }

  const pdfBytes = await doc.save();
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${sanitize(memberName)}_rank${rankNum}.pdf"`,
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
