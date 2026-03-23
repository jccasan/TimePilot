import {
  getPendingMutations,
  getPendingPhotos,
  updateMutationStatus,
  updatePhotoStatus,
  removePendingMutation,
  removePendingPhoto,
  type PendingMutation,
  type PendingPhoto,
} from "./offline-store";
import { getAuthHeaders } from "./queryClient";

export type SyncResult = {
  mutationsSynced: number;
  mutationsFailed: number;
  photosSynced: number;
  photosFailed: number;
  failedItems: { type: "mutation" | "photo"; id: string; error: string; url?: string }[];
};

async function replayMutation(mutation: PendingMutation): Promise<void> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
  };
  if (mutation.body) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(mutation.url, {
    method: mutation.method,
    headers,
    body: mutation.body ? JSON.stringify(mutation.body) : undefined,
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
}

async function uploadPendingPhoto(photo: PendingPhoto): Promise<string> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
  };
  const formData = new FormData();
  formData.append("file", photo.blob, `offline-photo-${photo.id}.jpg`);

  const uploadRes = await fetch("/api/uploads/direct", {
    method: "POST",
    headers,
    body: formData,
    credentials: "include",
  });
  if (!uploadRes.ok) throw new Error("Upload failed");
  const { objectPath } = await uploadRes.json();

  const patchField = photo.photoType === "before"
    ? "proofOfServicePhotoBefore"
    : photo.photoType === "after"
    ? "proofOfServicePhoto"
    : photo.photoType === "gate"
    ? "gateClosedPhoto"
    : photo.photoType === "extra"
    ? "proofOfServicePhoto"
    : null;

  if (patchField) {
    const patchRes = await fetch(`/api/visits/${photo.visitId}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ [patchField]: objectPath }),
      credentials: "include",
    });
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => "");
      throw new Error(`Patch failed: ${text}`);
    }
  }
  return objectPath;
}

export async function syncAll(
  onProgress?: (msg: string) => void
): Promise<SyncResult> {
  const result: SyncResult = {
    mutationsSynced: 0,
    mutationsFailed: 0,
    photosSynced: 0,
    photosFailed: 0,
    failedItems: [],
  };

  const photos = await getPendingPhotos();
  const pendingPhotosList = photos.filter(p => p.status === "pending" || p.status === "failed");
  const uploadedPaths = new Map<string, string>();

  for (const photo of pendingPhotosList) {
    try {
      await updatePhotoStatus(photo.id, "syncing");
      onProgress?.(`Uploading photo ${result.photosSynced + 1} of ${pendingPhotosList.length}...`);
      const objectPath = await uploadPendingPhoto(photo);
      uploadedPaths.set(photo.id, objectPath);
      await removePendingPhoto(photo.id);
      result.photosSynced++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      await updatePhotoStatus(photo.id, "failed", errorMsg);
      result.photosFailed++;
      result.failedItems.push({ type: "photo", id: photo.id, error: errorMsg });
    }
  }

  const mutations = await getPendingMutations();
  const pendingMutations = mutations.filter(m => m.status === "pending" || m.status === "failed");

  for (const mutation of pendingMutations) {
    try {
      if (mutation.body && typeof mutation.body === "object") {
        const body = mutation.body as Record<string, unknown>;
        for (const [key, value] of Object.entries(body)) {
          if (typeof value === "string" && value.startsWith("__pending_photo_") && value.endsWith("__")) {
            const photoId = value.slice(16, -2);
            const path = uploadedPaths.get(photoId);
            if (path) {
              body[key] = path;
            }
          }
        }
      }
      await updateMutationStatus(mutation.id, "syncing");
      onProgress?.(`Syncing action ${result.mutationsSynced + 1} of ${pendingMutations.length}...`);
      await replayMutation(mutation);
      await removePendingMutation(mutation.id);
      result.mutationsSynced++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      await updateMutationStatus(mutation.id, "failed", errorMsg);
      result.mutationsFailed++;
      result.failedItems.push({ type: "mutation", id: mutation.id, error: errorMsg, url: mutation.url });
    }
  }

  return result;
}
