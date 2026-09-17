import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Notes vault data is encrypted before it reaches Supabase. The encrypted
// payload may be stored in Supabase Storage when it becomes large.
const NOTES_VAULT_BUCKET = "pocket-vault-data";
const NOTES_VAULT_PATH = "app-data/main/notes-vault.json";

export const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadNotesVaultData(notesVault) {
  // Preserve legacy/empty vaults exactly as they are.
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

  // Keep the database schema/format the app already uses: metadata and keys
  // remain in app_data, while the encrypted ciphertext lives in Storage.
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

  // Already hydrated. This also keeps compatibility with older records that
  // contain data directly in app_data.
  if (notesVault.data?.iv && notesVault.data?.ciphertext) {
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

  if (!vaultData?.iv || !vaultData?.ciphertext) {
    throw new Error("Stored Notes vault data is invalid.");
  }

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

  // The app needs a transaction array to operate safely. Do not turn malformed
  // or partially loaded database state into an empty new database.
  if (!Array.isArray(payload.transactions)) {
    throw new Error("Pocket data is invalid: transactions are missing.");
  }

  // Restore the encrypted Notes payload from Storage when the database record
  // contains a dataStoragePath. This is required by the existing Notes vault
  // implementation and must not be removed by the safety changes.
  if (payload.notesVault?.dataStoragePath) {
    payload.notesVault = await hydrateNotesVault(payload.notesVault);
  }

  return payload;
}

async function saveDataInternal(payload, options = {}) {
  const { allowDestructive = false } = options;

  // Never write a partially initialized application state.
  if (!Array.isArray(payload?.transactions)) {
    throw new Error(
      "Refusing to save invalid Pocket data: transactions is not an array.",
    );
  }

  // Read the current server copy before writing. A UI/load bug that suddenly
  // produces an empty ledger must not silently overwrite the real one.
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

    // Intentional "Clear all data" is the only path allowed to empty a
    // previously populated transaction history in one operation.
    if (
      currentTransactions.length > 0 &&
      nextTransactions.length === 0 &&
      !allowDestructive
    ) {
      throw new Error(
        `Safety stop: Pocket tried to replace ${currentTransactions.length} transactions with 0. No data was changed.`,
      );
    }

    // Normal edits should not unexpectedly remove almost the entire ledger.
    // This catches corrupted/partially loaded state before it reaches Supabase.
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

  // Keep the existing Notes storage format intact.
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

// Serialize writes so rapid React state changes cannot race one another and
// restore an older snapshot after a newer one.
let saveQueue = Promise.resolve();

export function saveData(payload, options = {}) {
  const run = saveQueue
    .catch(() => {})
    .then(() => saveDataInternal(payload, options));

  saveQueue = run.catch(() => {});

  return run;
}
