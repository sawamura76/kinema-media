declare module 'butterchurn' {
  export interface Visualizer {
    loadPreset(preset: Record<string, unknown>, blend: number): void;
    render(options: { audioLevels: { timeByteArray: Uint8Array; timeByteArrayL: Uint8Array; timeByteArrayR: Uint8Array } }): void;
    setRendererSize(width: number, height: number): void;
  }
  const butterchurn: { createVisualizer(context: AudioContext, canvas: HTMLCanvasElement, options: Record<string, number>): Visualizer };
  export default butterchurn;
}
