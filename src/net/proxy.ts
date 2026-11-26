/**
 * The proxy setting, as the page sees it (Rust side: net.rs).
 *
 * Settings → Privacy → "Send Skrin's lookups through a proxy". Rust's clients
 * start from `net::builder()`; the page's own requests do too, through this:
 * `proxyFetchOptions()` goes into every `fetch` of tauri-plugin-http, and a
 * picture from the internet is asked of Rust (`remoteImage`) rather than
 * loaded by the webview, which has no proxy of its own. With the proxy on,
 * nothing here ever falls back to a direct request.
 */
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { setSetting } from '../metadata/api';
import { useOffline } from './offline';

export const PROXY_ENABLED_KEY = 'proxy_enabled';
export const PROXY_ADDRESS_KEY = 'proxy_address';

interface Current {
  enabled: boolean;
  address: string;
  noProxy: string;
}

let current: Promise<Current> | null = null;
const listeners = new Set<() => void>();

function ask(): Promise<Current> {
  // Not answering is "off", as before the setting existed.
  const off = { enabled: false, address: '', noProxy: '' };
  return Promise.resolve()
    .then(() => invoke<Current>('proxy_current'))
    .then((now) => (now?.enabled === true ? now : off))
    .catch(() => off);
}

/** What the proxy is now; asked of Rust once, again after a change. */
export function proxyNow(): Promise<Current> {
  current ??= ask();
  return current;
}

/** Tell everything that uses the proxy the setting changed. */
export function proxyChanged(): void {
  current = null;
  blobs.clear();
  listeners.forEach((l) => l());
}

/** Save the setting and use it from now on. */
export async function saveProxy(enabled: boolean, address: string): Promise<void> {
  await setSetting(PROXY_ADDRESS_KEY, address.trim());
  await setSetting(PROXY_ENABLED_KEY, enabled ? 'on' : 'off');
  proxyChanged();
}

/** The `proxy` part of a tauri-plugin-http `fetch`, when one is set. */
export async function proxyFetchOptions(): Promise<{ proxy?: { all: { url: string; noProxy: string } } }> {
  const now = await proxyNow();
  return now.enabled ? { proxy: { all: { url: now.address, noProxy: now.noProxy } } } : {};
}

export const normaliseProxy = (address: string) => invoke<string>('proxy_normalise', { address });
export const checkProxy = (address: string) => invoke<string>('check_proxy', { address });

/** Whether the proxy is on, kept up to date. Null until known. */
export function useProxyOn(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void proxyNow().then((n) => live && setOn(n.enabled));
    read();
    listeners.add(read);
    return () => {
      live = false;
      listeners.delete(read);
    };
  }, []);
  return on;
}

/** Pictures fetched through Rust, by address, for as long as the proxy stays as it is. */
const blobs = new Map<string, Promise<string>>();

/** A picture's address in a form the webview may load without a request of its own. */
export function remoteImage(url: string): Promise<string> {
  let blob = blobs.get(url);
  if (!blob) {
    blob = invoke<ArrayBuffer>('fetch_remote_image', { url }).then((bytes) =>
      URL.createObjectURL(new Blob([bytes]))
    );
    blob.catch(() => blobs.delete(url));
    blobs.set(url, blob);
  }
  return blob;
}

const REMOTE = /^https?:\/\//i;
export const isRemote = (src: string) => REMOTE.test(src);

/**
 * `src` as the page may show it: as it is when the proxy is off or the picture
 * is local; with the proxy on, a remote picture is fetched through it first
 * (null while that is under way, and when it fails — never the direct address).
 * In Keep everything on this computer a remote picture is never asked for:
 * null, so the drawn poster stands in (cache only — `local` comes first).
 */
export function useProxiedSrc(src: string | null): string | null {
  const proxyOn = useProxyOn();
  const offline = useOffline();
  const remote = src !== null && isRemote(src);
  // Asked through the proxy only outside the mode; until both are known, nothing.
  const on = offline === false ? proxyOn : null;
  const [loaded, setLoaded] = useState<{ src: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!on || !remote || src === null) return;
    let live = true;
    remoteImage(src).then(
      (url) => live && setLoaded({ src, url }),
      () => live && setLoaded({ src, url: null })
    );
    return () => {
      live = false;
    };
  }, [on, remote, src]);
  if (src === null || !remote) return src;
  if (offline !== false) return null;
  if (on === null) return null; // not known yet: not asked directly meanwhile
  if (!on) return src;
  return loaded?.src === src ? loaded.url : null;
}
