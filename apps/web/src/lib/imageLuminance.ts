export const getImageLuminance = (image: HTMLImageElement): number | null => {
  try {
    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;
    if (!w || !h) return null;

    const sampleSize = 24;
    const canvas = document.createElement("canvas");
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(image, 0, 0, sampleSize, sampleSize);
    const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize);
    if (!data?.length) return null;

    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha < 0.1) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Perceived luminance (Rec. 709)
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luminance;
      count += 1;
    }

    if (!count) return null;
    return sum / count;
  } catch {
    return null;
  }
};

export const shouldUseDarkTextOnImage = (image: HTMLImageElement): boolean | null => {
  const luminance = getImageLuminance(image);
  if (luminance == null) return null;
  // Bright image => dark text; dark image => light text
  return luminance >= 155;
};

