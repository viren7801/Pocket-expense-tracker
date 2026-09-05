import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// This bucket stores only the already-encrypted Notes vault payload.
// Attachments are inside the encrypted vault, so Supabase never receives
// readable note text or readable attachment contents.
const NOTES_VAULT_BUCKET = "pocket-vault-data";
const NOTES_VAULT_PATH = "app-data/main/notes-vault.json";

export const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadNotesVaultData(notesVault) {
  if (
    !notesVault ||
    notesVault.version !== 2 ||
    !notesVault.data ||
    !notesVault.data.iv ||
    !notesVault.data.ciphertext
  ) {
    return notesVault;
  }

  const body = JSON.stringify(notesVault.data);

  const { error } = await supabase.storage
    .from(NOTES_VAULT_BUCKET)
    .upload(NOTES_VAULT_PATH, new Blob([body], { type: "application/json" }), {
      upsert: true,
      contentType: "application/json",
      cacheControl: "no-store",
    });

  if (error) {
    console.error("Supabase Notes vault upload error:", error);
    throw new Error(
      `Notes vault upload failed: ${error.message || "Supabase Storage unavailable"}`,
    );
  }

  // Keep all vault keys/settings in Postgres, but move the potentially huge
  // encrypted ciphertext (including encrypted attachments) to Storage.
  return {
    ...notesVault,
    data: null,
    dataStoragePath: NOTES_VAULT_PATH,
  };
}

async function hydrateNotesVault(notesVault) {
  if (!notesVault?.dataStoragePath) {
    return notesVault;
  }

  const { data, error } = await supabase.storage
    .from(NOTES_VAULT_BUCKET)
    .download(notesVault.dataStoragePath);

  if (error) {
    console.error("Supabase Notes vault download error:", error);
    throw new Error(
      `Could not load Notes vault: ${error.message || "Supabase Storage unavailable"}`,
    );
  }

  const text = await data.text();
  const vaultData = JSON.parse(text);

  return {
    ...notesVault,
    data: vaultData,
  };
}

export async function loadData() {
  const { data, error } = await supabase
    .from("app_data")
    .select("payload")
    .eq("id", "main")
    .maybeSingle();

  if (error) {
    console.error("Supabase load error:", error);
    throw error;
  }

  if (!data?.payload) {
    return null;
  }

  const payload = { ...data.payload };

  if (payload.notesVault?.dataStoragePath) {
    payload.notesVault = await hydrateNotesVault(payload.notesVault);
  }

  return payload;
}

export async function saveData(payload) {
  const notesVault = await uploadNotesVaultData(payload.notesVault);

  const payloadForDatabase = {
    ...payload,
    notesVault,
  };

  const { error } = await supabase.from("app_data").upsert(
    {
      id: "main",
      payload: payloadForDatabase,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error("Supabase save error:", error);
    throw new Error(error.message || "Supabase database save failed.");
  }
}
