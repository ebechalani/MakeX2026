// Convert .docx rules into HTML for embedding in the academy panel.
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';

const docs = [
  { src: 'public/rules/sportswonderland_rules.docx', out: 'public/rules/sportswonderland_rules.html' },
  { src: 'public/rules/smartlogistics_rules.docx', out: 'public/rules/smartlogistics_rules.html' },
];

for (const d of docs) {
  if (!fs.existsSync(d.src)) { console.warn('missing:', d.src); continue; }
  const { value: html, messages } = await mammoth.convertToHtml({ path: d.src });
  // Wrap with a class for styling
  const wrapped = `<div class="docx">\n${html}\n</div>`;
  fs.writeFileSync(d.out, wrapped, 'utf8');
  console.log(`✓ ${d.src} → ${d.out} (${html.length} bytes)`);
  if (messages.length) for (const m of messages) console.log('  · ' + m.message);
}
