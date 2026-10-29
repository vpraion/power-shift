import { toaster } from "@decky/api";

let lastToastTime = 0;

export function showToast(title: string, body: string) {
  const now = Date.now();
  if (now - lastToastTime < 3000) {
    return;
  }
  lastToastTime = now;

  try {
    if (toaster && typeof toaster.toast === "function") {
      toaster.toast({ title, body });
      return;
    }
  } catch (_) {}

  try {
    const deckyToaster = (window as any).DeckyPluginLoader?.toaster;
    if (deckyToaster && typeof deckyToaster.toast === "function") {
      deckyToaster.toast({ title, body });
    }
  } catch (_) {}
}

export function showErrorToast(property: string, context: string = "") {
  const msg = context ? `Property '${property}' not found (${context})` : `Property '${property}' not found`;
  showToast("PowerShift Error", msg);
}
