# MakeX 2026 — Competition Management System

## Setup

1. Create a Supabase project at https://supabase.com
2. Run `supabase/schema.sql` in the Supabase SQL editor
3. Copy `.env.local` and fill in your Supabase URL and anon key
4. Run `npm install && npm run dev`
5. Deploy to Vercel: connect repo and add environment variables

## Pages

- `/` — Homepage with links to all views
- `/admin` — Admin management (categories, passations, results)
- `/judge` — Judge interface (queue, scoring, signatures)
- `/coach` — Coach/teacher team tracker
- `/live` — Public display screen (NOW/NEXT/PREPARE)

## Supabase Realtime

Enable realtime for the `passations`, `categories`, and `tables` tables in the Supabase dashboard under Database > Replication.

## Deploy

Push to GitHub and connect to Vercel. Add environment variables in Vercel dashboard.
