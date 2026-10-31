/*
 * The app's pages get a small door to the desktop shell, as `window.versaaDesktop`:
 *   confirm  the "are you sure?" question, asked by the shell so its buttons
 *            are in English (Windows translates a plain OK/Cancel into the
 *            computer's language);
 *   updates  Settings → App updates, only in a build with the updater
 *            (see desktop/UPDATER.md).
 * Nothing else is exposed.
 */
import { contextBridge, ipcRenderer } from "electron";

declare const __VERSAA_UPDATER__: boolean;

contextBridge.exposeInMainWorld("versaaDesktop", {
  confirm: (message: string): boolean => ipcRenderer.sendSync("versaa:confirm", String(message)) === true,
  ...(__VERSAA_UPDATER__
    ? {
        updates: {
          status: () => ipcRenderer.invoke("versaa-updates:status"),
          check: () => ipcRenderer.invoke("versaa-updates:check"),
          install: () => ipcRenderer.invoke("versaa-updates:install"),
        },
      }
    : {}),
});
