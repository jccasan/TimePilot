/**
 * Compress an image file using the browser Canvas API before uploading.
 * Non-image files (PDFs, etc.) are returned unchanged.
 *
 * @param file    The original File from a file input or camera capture.
 * @param maxPx   Maximum width or height in pixels. Larger images are scaled
 *                down proportionally. Default: 1920 (full HD).
 * @param quality JPEG quality 0–1. Default: 0.82 (~82 %).
 * @returns       A compressed JPEG File (same base name, .jpg extension), or
 *                the original file if it is not an image or compression fails.
 */
export async function compressImage(
  file: File,
  maxPx = 1920,
  quality = 0.82,
): Promise<File> {
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
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}
