import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { emptyData, type AppData, validateBirthday } from "./model";

export const native = isTauri();
const STORAGE_KEY = "life-progress.preview.v1";
export interface Snapshot {
  data: AppData; interactive: boolean; dataPath: string; loadError: string | null; warning: string | null;
}
export async function loadSnapshot(): Promise<Snapshot> {
  if (native) return invoke<Snapshot>("load_data");
  let data = emptyData();
  let loadError: string | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as AppData;
      if (value.version !== 1 || value.targetAge !== 90 || !value.milestones || typeof value.breathing !== "boolean") throw new Error("预览数据格式不合法。");
      if (value.birthDate) validateBirthday(value.birthDate);
      value.orientation ??= "horizontal";
      value.centered ??= true;
      value.displayScale ??= "medium";
      if (!["small", "medium", "large"].includes(value.displayScale)) throw new Error("预览显示比例不合法。");
      if (!["horizontal", "vertical"].includes(value.orientation) || typeof value.centered !== "boolean") throw new Error("预览布局设置不合法。");
      data = value;
    }
  } catch (error) { loadError = String(error); }
  return { data, interactive: true, dataPath: "浏览器预览：localStorage（桌面应用独立保存 JSON）", loadError, warning: null };
}
export async function saveData(data: AppData): Promise<AppData> {
  if (native) return invoke<AppData>("save_data", { data });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}
export async function recoverData(): Promise<AppData> {
  if (native) return invoke<AppData>("recover_data");
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) localStorage.setItem(STORAGE_KEY + ".corrupt." + Date.now(), raw);
  return saveData(emptyData());
}
export async function changeMode(interactive: boolean): Promise<void> {
  if (native) await invoke("set_mode", { interactive });
}
export async function beginDrag(): Promise<void> { if (native) await invoke("begin_drag"); }
export async function quitApp(): Promise<void> { if (native) await invoke("quit_app"); }
export async function subscribe(onMode: (value: boolean) => void, onFinish: (quit: boolean) => void): Promise<void> {
  if (!native) return;
  await listen<boolean>("mode-changed", event => onMode(event.payload));
  await listen<boolean>("finish-editing", event => onFinish(event.payload));
}
