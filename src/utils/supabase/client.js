import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing Supabase environment variables!");
  console.error("URL:", supabaseUrl);
  console.error("Key:", supabaseKey ? "EXISTS" : "MISSING");
}

export const createClient = () => {
  const client = createBrowserClient(supabaseUrl, supabaseKey);
  return client;
};
