// Test-only host: the shipped app talks directly to Tauri and has no browser storage.
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { emptyData } from "../../src/model";

let interactive = true;
mockIPC(async (command, args) => {
  switch (command) {
    case "load_data":
      return { data: JSON.parse(localStorage.getItem("life-progress.test") ?? "null") ?? emptyData(), interactive, loadError: null, warning: null };
    case "save_data":
      localStorage.setItem("life-progress.test", JSON.stringify(args?.data));
      return args?.data;
    case "set_mode":
      interactive = Boolean(args?.interactive);
      await emit("mode-changed", interactive);
      return;
    case "begin_drag":
    case "quit_app":
      return;
    default:
      throw new Error(`Unexpected command: ${command}`);
  }
}, { shouldMockEvents: true });
await import("../../src/main");
