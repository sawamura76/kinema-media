export interface Crop { x: number; y: number; width: number; height: number }
export function cropFrame(width: number, height: number, ratio: number, zoom: number, horizontal: number, vertical: number): Crop {
  const w = Math.min(width, height * ratio) / Math.max(1, zoom / 100);
  const h = w / ratio;
  return { x: (width - w) * Math.max(0, Math.min(100, horizontal)) / 100 / width,
    y: (height - h) * Math.max(0, Math.min(100, vertical)) / 100 / height, width: w / width, height: h / height };
}
