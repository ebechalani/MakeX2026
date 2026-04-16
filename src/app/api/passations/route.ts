import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const tableId = searchParams.get('table_id');
  const coachName = searchParams.get('coach_name');
  let query = supabase.from('passations').select('*, category:categories(*), table:tables(*)');
  if (tableId) query = query.eq('table_id', tableId);
  if (coachName) query = query.ilike('coach_name', `%${coachName}%`);
  const { data, error } = await query.order('queue_position').order('scheduled_time');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
