import Dexie from "dexie";

// A single local IndexedDB database — all data lives in the browser,
// nothing is sent anywhere. Free, offline-capable, no account needed.
export const db = new Dexie("LedgerDB");

db.version(1).stores({
  kv: "id", // one row: { id: 'main', payload: {...} }
});

export async function loadData() {
  const row = await db.kv.get("main");
  return row ? row.payload : null;
}

export async function saveData(payload) {
  await db.kv.put({ id: "main", payload });
}
