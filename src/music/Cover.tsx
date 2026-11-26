import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
export default function Cover({ path, label }: { path: string | null; label: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return path && failed !== path ? <img src={convertFileSrc(path)} alt={label} loading="lazy" onError={() => setFailed(path)} /> : <span className="music-placeholder" aria-hidden="true">♫</span>;
}
