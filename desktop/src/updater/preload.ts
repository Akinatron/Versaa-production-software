/*
 * Gives the app's pages (Settings → App updates) a small door to the updater
 * in the desktop shell. Nothing else is exposed. See desktop/UPDATER.md.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("versaaDesktop", {
  updates: {
    status: () => ipcRenderer.invoke("versaa-updates:status"),
    check: () => ipcRenderer.invoke("versaa-updates:check"),
    install: () => ipcRenderer.invoke("versaa-updates:install"),
  },
});
