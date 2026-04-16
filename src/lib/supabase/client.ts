import { createBrowserClient } from '@supabase/ssr';

let clientInstance: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (typeof window === 'undefined') {
    // Return a dummy client during SSR — pages are client-only and never actually use it on server
    return createBrowserClient(
      'https://placeholder.supabase.co',
      'placeholder-key'
    );
  }
  if (!clientInstance) {
    clientInstance = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return clientInstance;
}
