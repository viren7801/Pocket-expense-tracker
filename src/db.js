import { createClient } from "@supabase/supabase-js";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("DEBUG supabaseUrl:", JSON.stringify(supabaseUrl));
console.log(
  "DEBUG supabaseKey type:",
  typeof supabaseKey,
  "length:",
  supabaseKey ? supabaseKey.length : "N/A",
);
console.log(
  "DEBUG all VITE env keys:",
  Object.keys(import.meta.env).filter((k) => k.startsWith("VITE_")),
);

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function loadData() {
  const { data, error } = await supabase
    .from("app_data")
    .select("payload")
    .eq("id", "main")
    .maybeSingle();

  if (error) {
    console.error("Supabase load error:", error);
    return null;
  }
  return data ? data.payload : null;
}

export async function saveData(payload) {
  const { error } = await supabase
    .from("app_data")
    .upsert({ id: "main", payload, updated_at: new Date().toISOString() });

  if (error) {
    console.error("Supabase save error:", error);
    throw error;
  }
}
