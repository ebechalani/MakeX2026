import { PDFDocument, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

const TEMPLATE_PATH = path.resolve('C:\\Users\\eddy.bachaalany\\Downloads\\Copy of ---Lycee Montaigne--.pdf (1).pdf');
const bytes = fs.readFileSync(TEMPLATE_PATH);
const doc = await PDFDocument.load(bytes);
const page = doc.getPages()[0];
const { width, height } = page.getSize();
console.log('Page:', width.toFixed(2), 'x', height.toFixed(2));

const font     = await doc.embedFont(StandardFonts.Helvetica);
const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
console.log('YYYYY @ 17.9 (bold):', fontBold.widthOfTextAtSize('YYYYY', 17.9).toFixed(2));
console.log('YYYYY @ 11.6:',         font.widthOfTextAtSize('YYYYY', 11.6).toFixed(2));
console.log('xxxxx @ 11:',           font.widthOfTextAtSize('xxxxx', 11).toFixed(2));
