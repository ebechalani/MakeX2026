// Server-only admin password check. The password is never sent to the client bundle.
// Set ADMIN_PASSWORD in your .env.local (do NOT prefix with NEXT_PUBLIC_).
import { NextResponse } from 'next/server';

// Very simple in-memory rate limit (per server instance) — slows brute force
const attempts = new Map<string, { count: number; lockUntil: number }>();

function ipOf(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0]?.trim() || 'unknown';
}

export async function POST(req: Request) {
  const ip = ipOf(req);
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, lockUntil: 0 };
  if (now < rec.lockUntil) {
    const wait = Math.ceil((rec.lockUntil - now) / 1000);
    return NextResponse.json({ ok: false, error: `Locked. Try again in ${wait}s.` }, { status: 429 });
  }

  const { password } = await req.json().catch(() => ({ password: '' }));
  // Reads from env var; falls back to default for local dev environments
  const expected = process.env.ADMIN_PASSWORD || 'MakeX@2026';
  if (typeof password === 'string' && password === expected) {
    attempts.delete(ip);
    return NextResponse.json({ ok: true });
  }
  rec.count += 1;
  if (rec.count >= 3) {
    const lockSecs = 30 * Math.pow(2, rec.count - 3);
    rec.lockUntil = now + lockSecs * 1000;
  }
  attempts.set(ip, rec);
  return NextResponse.json({ ok: false, error: 'Wrong password.' }, { status: 401 });
}
