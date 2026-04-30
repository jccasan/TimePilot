import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "scoopilot-offline";
const DB_VERSION = 1;

export interface PendingMutation {
  id: string;
  method: string;
  url: string;
  body?: unknown;
  createdAt: number;
  status: "pending" | "syncing" | "failed";
  errorMessage?: string;
  resolvedPhotoPaths?: Record<string, string>;
}

export interface PendingPhoto {
  id: string;
  visitId: string;
  photoType: "before" | "after" | "gate" | "extra";
  blob: Blob;
  createdAt: number;
  status: "pending" | "syncing" | "failed";
  errorMessage?: string;
}

interface OfflineDB {
  cachedRoutes: {
    key: string;
    value: { key: string; data: unknown; cachedAt: number };
  };
  pendingMutations: {
    key: string;
    value: PendingMutation;
    indexes: { "by-status": string };
  };
  pendingPhotos: {
    key: string;
    value: PendingPhoto;
    indexes: { "by-status": string; "by-visit": string };
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function getDB(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("cachedRoutes")) {
          db.createObjectStore("cachedRoutes", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("pendingMutations")) {
          const store = db.createObjectStore("pendingMutations", { keyPath: "id" });
          store.createIndex("by-status", "status");
        }
        if (!db.objectStoreNames.contains("pendingPhotos")) {
          const store = db.createObjectStore("pendingPhotos", { keyPath: "id" });
          store.createIndex("by-status", "status");
          store.createIndex("by-visit", "visitId");
        }
      },
    });
  }
  return dbPromise;
}

export async function cacheRouteData(key: string, data: unknown): Promise<void> {
  const db = await getDB();
  await db.put("cachedRoutes", { key, data, cachedAt: Date.now() });
}

export async function getCachedRouteData<T>(key: string): Promise<T | null> {
  const db = await getDB();
  const entry = await db.get("cachedRoutes", key);
  return entry ? (entry.data as T) : null;
}

export async function addPendingMutation(
  mutation: Omit<PendingMutation, "id" | "createdAt" | "status">
): Promise<string> {
  const db = await getDB();
  const id = `mut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.put("pendingMutations", {
    ...mutation,
    id,
    createdAt: Date.now(),
    status: "pending",
  });
  return id;
}

export async function getPendingMutations(): Promise<PendingMutation[]> {
  const db = await getDB();
  const all = await db.getAll("pendingMutations");
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateMutationStatus(
  id: string,
  status: PendingMutation["status"],
  errorMessage?: string
): Promise<void> {
  const db = await getDB();
  const mutation = await db.get("pendingMutations", id);
  if (mutation) {
    mutation.status = status;
    if (errorMessage) mutation.errorMessage = errorMessage;
    await db.put("pendingMutations", mutation);
  }
}

export async function saveMutationUpdate(
  id: string,
  updates: Partial<PendingMutation>
): Promise<void> {
  const db = await getDB();
  const mutation = await db.get("pendingMutations", id);
  if (mutation) {
    Object.assign(mutation, updates);
    await db.put("pendingMutations", mutation);
  }
}
export async function removePendingMutation(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("pendingMutations", id);
}

export async function addPendingPhoto(
  photo: Omit<PendingPhoto, "id" | "createdAt" | "status">
): Promise<string> {
  const db = await getDB();
  const id = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.put("pendingPhotos", {
    ...photo,
    id,
    createdAt: Date.now(),
    status: "pending",
  });
  return id;
}

export async function getPendingPhotos(): Promise<PendingPhoto[]> {
  const db = await getDB();
  const all = await db.getAll("pendingPhotos");
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getPendingPhotosForVisit(visitId: string): Promise<PendingPhoto[]> {
  const db = await getDB();
  return db.getAllFromIndex("pendingPhotos", "by-visit", visitId);
}

export async function updatePhotoStatus(
  id: string,
  status: PendingPhoto["status"],
  errorMessage?: string
): Promise<void> {
  const db = await getDB();
  const photo = await db.get("pendingPhotos", id);
  if (photo) {
    photo.status = status;
    if (errorMessage) photo.errorMessage = errorMessage;
    await db.put("pendingPhotos", photo);
  }
}

export async function removePendingPhoto(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("pendingPhotos", id);
}

export async function getPendingCount(): Promise<number> {
  const db = await getDB();
  const mutations = await db.count("pendingMutations");
  const photos = await db.count("pendingPhotos");
  return mutations + photos;
}

export async function clearAllPending(): Promise<void> {
  const db = await getDB();
  await db.clear("pendingMutations");
  await db.clear("pendingPhotos");
}
