/**
 * A picture from the internet in a candidate list (Fix match). With the proxy
 * on it comes through the proxy (`useProxiedSrc`), so a poster is never asked
 * of the internet by the webview itself.
 */
import { useProxiedSrc } from '../net/proxy';

export default function RemoteImg({ src }: { src: string }) {
  const shown = useProxiedSrc(src);
  return shown ? <img src={shown} alt="" loading="lazy" /> : <div className="poster-placeholder">no poster</div>;
}
