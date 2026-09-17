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
  const requiredArrays = [
    "accounts",
    "transactions",
    "budgets",
    "goals",
    "recurring",
    "reminders",
  ];

  for (const key of requiredArrays) {
    if (!Array.isArray(payload[key])) {
      throw new Error(
        `Pocket data is invalid or incomplete: ${key} is missing.`,
      );
    }
  }

  if (payload.notesVault?.dataStoragePath) {
    payload.notesVault = await hydrateNotesVault(payload.notesVault);
  }

  return payload;
}

async function saveDataInternal(payload, options = {}) {
  const { allowDestructive = false } = options;

  // Safety contract: the main payload must always contain the core arrays.
  // A transient/failed UI state must never be allowed to replace real data.
  const requiredArrays = [
    "accounts",
    "transactions",
    "budgets",
    "goals",
    "recurring",
    "reminders",
  ];

  for (const key of requiredArrays) {
    if (!Array.isArray(payload?.[key])) {
      throw new Error(
        `Refusing to save invalid Pocket data: ${key} is not an array.`,
      );
    }
  }

  // Read the current server copy before every write. This is intentionally
  // conservative: if the new state suddenly loses a large amount of data,
  // block the write instead of turning a UI bug into permanent data loss.
  const { data: currentRow, error: readError } = await supabase
    .from("app_data")
    .select("payload")
    .eq("id", "main")
    .maybeSingle();

  if (readError) {
    console.error("Supabase pre-save safety check failed:", readError);
    throw new Error(
      `Pocket could not verify the existing data before saving: ${
        readError.message || "Supabase unavailable"
      }`,
    );
  }

  const current = currentRow?.payload;

  if (current) {
    const currentTransactions = Array.isArray(current.transactions)
      ? current.transactions
      : [];
    const nextTransactions = payload.transactions;

    // Never silently replace an existing transaction history with an empty
    // one. An explicit clear-all operation is the only exception.
    if (
      currentTransactions.length > 0 &&
      nextTransactions.length === 0 &&
      !allowDestructive
    ) {
      throw new Error(
        `Safety stop: Pocket tried to replace ${currentTransactions.length} transactions with 0. No data was changed.`,
      );
    }

    // Also protect against a catastrophic partial-state overwrite. Normal
    // edits should not delete 90%+ of the transaction history in one save.
    if (
      currentTransactions.length >= 10 &&
      nextTransactions.length < currentTransactions.length * 0.1 &&
      !allowDestructive
    ) {
      throw new Error(
        `Safety stop: transaction count dropped from ${currentTransactions.length} to ${nextTransactions.length}. No data was changed.`,
      );
    }
  }

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

// Serialize writes so rapid React state changes cannot race each other and
// accidentally restore an older snapshot after a newer one.
let saveQueue = Promise.resolve();

export function saveData(payload, options = {}) {
  const run = saveQueue
    .catch(() => {})
    .then(() => saveDataInternal(payload, options));

  saveQueue = run.catch(() => {});

  return run;
}
