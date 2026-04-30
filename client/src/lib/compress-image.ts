/**
 * Shared image compression utilities.
 *
 * compressImage()           — Service photo upload path (proof-of-service,
 *                             gate photos, extras). Always converts to JPEG,
 *                             always compresses, never throws — falls back to
 *                             the original file on any error.
 *
 * compressMessageAttachment() — MMS / messaging attachment path. Validates the
 *                             mime type, preserves PNG format, and only
 *                             compresses when the file exceeds MAX_FILE_SIZE.
 *
 * Shared constants for the messaging flow:
 *   ALLOWED_IMAGE_TYPES     — accepted mime types for MMS attachments
 *   MAX_ATTACHMENT_SIZE     — hard cap before the server rejects the file (5 MB)
 */

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
export const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;

const MSG_MAX_DIMENSION = 1600;
const MSG_QUALITY = 0.7;
const MSG_MAX_FILE_SIZE = 600 * 1024;

/**
 * Compress a service photo before uploading.
 *
 * - Skips non-image files (returns original)
 * - Scales down to `maxPx` (default 1920) preserving aspect ratio
 * - Always exports as JPEG at `quality` (default 0.82)
 * - Returns the original file if any step fails (never throws)
 */
export async function compressImage(file: File, maxPx = 1920, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  return new Promise<File>((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        const ratio = Math.min(maxPx / width, maxPx / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const baseName = file.name.replace(/\.[^.]+$/, "");
          resolve(new File([blob], `${baseName}.jpg`, { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

/**
 * Compress a messaging / MMS attachment.
 *
 * - Throws if the mime type is not in ALLOWED_IMAGE_TYPES
 * - Returns the file unchanged if it is already under MSG_MAX_FILE_SIZE (600 KB)
 * - Preserves PNG format; converts everything else to JPEG
 * - Scales down to 1600px max
 */
export async function compressMessageAttachment(file: File): Promise<File> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}. Allowed: JPG, PNG, WebP`);
  }

  if (file.size <= MSG_MAX_FILE_SIZE) return file;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    el.src = url;
  });

  let { width, height } = img;
  if (width > MSG_MAX_DIMENSION || height > MSG_MAX_DIMENSION) {
    const ratio = Math.min(MSG_MAX_DIMENSION / width, MSG_MAX_DIMENSION / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  ctx.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(img.src);

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const quality = outputType === "image/png" ? undefined : MSG_QUALITY;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Compression failed"))),
      outputType,
      quality
    );
  });

  const ext = outputType === "image/png" ? ".png" : ".jpg";
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}${ext}`, { type: outputType });
}
