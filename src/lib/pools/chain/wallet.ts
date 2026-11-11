import type { Eip1193Provider } from "./core";

export interface WalletOption {
  id: string;
  name: string;
  // The wallet's own icon, as it announces it. Only inline images are kept, so showing it loads nothing.
  icon: string | null;
  provider: Eip1193Provider;
}

interface Announcement {
  info?: { uuid?: unknown; name?: unknown; rdns?: unknown; icon?: unknown };
  provider?: Eip1193Provider;
}

const inlineImage = (icon: unknown) => (typeof icon === "string" && /^data:image\/(png|svg\+xml|webp|jpeg|gif);/.test(icon) && icon.length < 60_000 ? icon : null);

interface WalletWindow {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  dispatchEvent(event: Event): boolean;
  phantom?: { ethereum?: Eip1193Provider };
  ethereum?: Eip1193Provider;
}

const isProvider = (p: unknown): p is Eip1193Provider => typeof p === "object" && p !== null && typeof (p as Eip1193Provider).request === "function";

// Wallets announce themselves through EIP-6963; older ones are found on window.phantom.ethereum or
// window.ethereum. Phantom is listed first when present.
export function discoverWallets(win: WalletWindow, waitMs = 400): Promise<WalletOption[]> {
  return new Promise((resolve) => {
    const found = new Map<string, WalletOption>();
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Announcement>).detail;
      if (!detail || !isProvider(detail.provider)) return;
      const name = typeof detail.info?.name === "string" ? detail.info.name.slice(0, 40) : "Wallet";
      const id = typeof detail.info?.rdns === "string" ? detail.info.rdns : typeof detail.info?.uuid === "string" ? detail.info.uuid : name;
      if (![...found.values()].some((w) => w.provider === detail.provider)) found.set(id, { id, name, icon: inlineImage(detail.info?.icon), provider: detail.provider });
    };
    win.addEventListener("eip6963:announceProvider", onAnnounce);
    win.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      win.removeEventListener("eip6963:announceProvider", onAnnounce);
      const known = (p: Eip1193Provider) => [...found.values()].some((w) => w.provider === p);
      const phantom = win.phantom?.ethereum;
      if (isProvider(phantom) && !known(phantom)) found.set("app.phantom", { id: "app.phantom", name: "Phantom", icon: null, provider: phantom });
      if (isProvider(win.ethereum) && !known(win.ethereum)) found.set("injected", { id: "injected", name: "Browser wallet", icon: null, provider: win.ethereum });
      const list = [...found.values()];
      list.sort((a, b) => Number(/phantom/i.test(b.name)) - Number(/phantom/i.test(a.name)));
      resolve(list);
    }, waitMs);
  });
}
