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

async function uploadPhotoBlob(blob: Blob, photoId: string): Promise<string> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
  };
  const formData = new FormData();
  formData.append("file", blob, `offline-photo-${photoId}.jpg`);

  const uploadRes = await fetch("/api/uploads/direct", {
    method: "POST",
    headers,
    body: formData,
    credentials: "include",
  });
  if (!uploadRes.ok) throw new Error("Upload failed");
  const { objectPath } = await uploadRes.json();
  return objectPath;
}

async function uploadAndPatchStandalonePhoto(photo: PendingPhoto): Promise<void> {
  const objectPath = await uploadPhotoBlob(photo.blob, photo.id);

  const patchField = photo.photoType === "before"
    ? "proofOfServicePhotoBefore"
    : photo.photoType === "after"
    ? "proofOfServicePhoto"
    : null;

  if (patchField) {
    const headers: Record<string, string> = {
      ...getAuthHeaders(),
      "Content-Type": "application/json",
    };
    const patchRes = await fetch(`/api/visits/${photo.visitId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ [patchField]: objectPath }),
      credentials: "include",
    });
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => "");
      throw new Error(`Patch failed: ${text}`);
    }
  }
}

async function resolvePendingPhotoRefs(
  body: Record<string, unknown>,
  pendingPhotosMap: Map<string, PendingPhoto>,
  uploadedPaths: Map<string, string>
): Promise<void> {
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string" && value.startsWith("__pending_photo_") && value.endsWith("__")) {
      const photoId = value.slice(16, -2);
      let path = uploadedPaths.get(photoId);
      if (!path) {
        const photo = pendingPhotosMap.get(photoId);
        if (photo) {
          path = await uploadPhotoBlob(photo.blob, photo.id);
          uploadedPaths.set(photoId, path);
          await removePendingPhoto(photoId);
        }
      }
      if (path) body[key] = path;
    }
    if (Array.isArray(value)) {
      const resolvedArr: string[] = [];
      for (const item of value) {
        if (typeof item === "string" && item.startsWith("__pending_photo_") && item.endsWith("__")) {
          const photoId = item.slice(16, -2);
          let path = uploadedPaths.get(photoId);
          if (!path) {
            const photo = pendingPhotosMap.get(photoId);
            if (photo) {
              path = await uploadPhotoBlob(photo.blob, photo.id);
              uploadedPaths.set(photoId, path);
              await removePendingPhoto(photoId);
            }
          }
          if (path) resolvedArr.push(path);
        } else if (typeof item === "string") {
          resolvedArr.push(item);
        }
      }
      body[key] = resolvedArr;
    }
  }
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

  const allPhotos = await getPendingPhotos();
  const pendingPhotosMap = new Map<string, PendingPhoto>();
  for (const p of allPhotos) {
    if (p.status === "pending" || p.status === "failed") {
      pendingPhotosMap.set(p.id, p);
    }
  }
  const uploadedPaths = new Map<string, string>();

  const mutations = await getPendingMutations();
  const pendingMutations = mutations.filter(m => m.status === "pending" || m.status === "failed");

  for (const mutation of pendingMutations) {
    try {
      if (mutation.body && typeof mutation.body === "object" && !Array.isArray(mutation.body)) {
        await resolvePendingPhotoRefs(
          mutation.body as Record<string, unknown>,
          pendingPhotosMap,
          uploadedPaths
        );
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

  const remainingPhotos = await getPendingPhotos();
  const standalonePhotos = remainingPhotos.filter(
    p => (p.status === "pending" || p.status === "failed") &&
      (p.photoType === "before" || p.photoType === "after")
  );

  for (const photo of standalonePhotos) {
    try {
      await updatePhotoStatus(photo.id, "syncing");
      onProgress?.(`Uploading photo ${result.photosSynced + 1}...`);
      await uploadAndPatchStandalonePhoto(photo);
      await removePendingPhoto(photo.id);
      result.photosSynced++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      await updatePhotoStatus(photo.id, "failed", errorMsg);
      result.photosFailed++;
      result.failedItems.push({ type: "photo", id: photo.id, error: errorMsg });
    }
  }

  for (const [photoId, path] of uploadedPaths) {
    if (path) result.photosSynced++;
    pendingPhotosMap.delete(photoId);
  }

  return result;
}

export function isNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true;
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed")) {
      return true;
    }
  }
  if (err instanceof DOMException && err.name === "AbortError") return true;
  return false;
}
