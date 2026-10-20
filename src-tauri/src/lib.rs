mod data;
use data::AppData;
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Runtime {
    data: AppData,
    load_error: Option<String>,
    warning: Option<String>,
    interactive: bool,
}
struct AppState {
    path: PathBuf,
    runtime: Mutex<Runtime>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    #[serde(flatten)]
    runtime: Runtime,
    data_path: String,
}

#[tauri::command]
fn load_data(state: State<AppState>) -> Result<Snapshot, String> {
    let runtime = state.runtime.lock().map_err(|e| e.to_string())?;
    Ok(Snapshot {
        runtime: runtime.clone(),
        data_path: state.path.display().to_string(),
    })
}

#[tauri::command]
fn save_data(state: State<AppState>, data: AppData) -> Result<AppData, String> {
    let mut runtime = state.runtime.lock().map_err(|e| e.to_string())?;
    if runtime.load_error.is_some() {
        return Err("原数据无法读取，请先使用恢复按钮；不会覆盖原文件。".into());
    }
    data::write_data(&state.path, &data)?;
    runtime.data = data.clone();
    Ok(data)
}

#[tauri::command]
fn recover_data(state: State<AppState>) -> Result<AppData, String> {
    let mut runtime = state.runtime.lock().map_err(|e| e.to_string())?;
    if runtime.load_error.is_none() {
        return Ok(runtime.data.clone());
    }
    let backup = state.path.with_extension("json.bak");
    // Preserve the unreadable file before trying any recovery.
    let suffix = chrono::Local::now().format("%Y%m%d-%H%M%S-%f");
    if state.path.exists() {
        std::fs::rename(
            &state.path,
            state.path.with_extension(format!("json.corrupt-{suffix}")),
        )
        .map_err(|e| e.to_string())?;
    }
    let recovered = data::read_data(&backup).unwrap_or_default();
    data::write_data(&state.path, &recovered)?;
    runtime.data = recovered.clone();
    runtime.load_error = None;
    Ok(recovered)
}

#[tauri::command]
fn set_mode(app: AppHandle, interactive: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("找不到主窗口")?;
    let state = app.state::<AppState>();
    let mut runtime = state.runtime.lock().map_err(|e| e.to_string())?;
    let transition = (|| -> tauri::Result<()> {
        if interactive {
            window.set_always_on_bottom(false)?;
            window.set_ignore_cursor_events(false)?;
            window.show()?;
            window.unminimize()?;
            window.set_focus()?;
            // ShowWindow / restore can reset z-order during a hidden first launch.
            window.set_always_on_top(true)?;
        } else {
            // Release the foreground before enabling click-through.
            window.set_always_on_top(false)?;
            window.set_always_on_bottom(true)?;
            window.set_ignore_cursor_events(true)?;
            window.show()?;
        }
        Ok(())
    })();
    if let Err(error) = transition {
        // An OS failure must not leave a click-through foreground window.
        let _ = window.set_ignore_cursor_events(false);
        let _ = window.set_always_on_bottom(false);
        let _ = window.set_always_on_top(true);
        runtime.interactive = true;
        let _ = app.emit("mode-changed", true);
        return Err(format!("无法切换窗口模式：{error}"));
    }
    runtime.interactive = interactive;
    app.emit("mode-changed", interactive)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn is_interactive(app: &AppHandle) -> bool {
    app.state::<AppState>()
        .runtime
        .lock()
        .map(|r| r.interactive)
        .unwrap_or(true)
}

fn request_finish(app: &AppHandle, quit: bool) {
    if quit && !is_interactive(app) {
        app.exit(0);
    } else if let Err(error) = app.emit("finish-editing", quit) {
        eprintln!("{error}");
    }
}

fn toggle(app: &AppHandle) {
    if is_interactive(app) {
        request_finish(app, false);
    } else if let Err(error) = set_mode(app.clone(), true) {
        eprintln!("{error}");
    }
}

#[tauri::command]
fn begin_drag(window: tauri::WebviewWindow, state: State<AppState>) -> Result<(), String> {
    if state.runtime.lock().map_err(|e| e.to_string())?.interactive {
        window.start_dragging().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Err(error) = set_mode(app.clone(), true) {
                eprintln!("{error}");
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            recover_data,
            set_mode,
            begin_drag,
            quit_app
        ])
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            // Native integration tests use an isolated directory; release builds always use app data.
            #[cfg(debug_assertions)]
            let directory = std::env::var_os("LIFE_PROGRESS_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(directory);
            let path = directory.join("milestones.json");
            let (data, load_error) = match data::read_data(&path) {
                Ok(data) => (data, None),
                Err(error) => (AppData::default(), Some(error)),
            };
            app.manage(AppState {
                path,
                runtime: Mutex::new(Runtime {
                    data,
                    load_error,
                    warning: None,
                    interactive: false,
                }),
            });
            let menu = MenuBuilder::new(app).text("quit", "保存并退出").build()?;
            TrayIconBuilder::with_id("life-progress")
                .icon(app.default_window_icon().ok_or("缺少应用图标")?.clone())
                .tooltip("Life Progress · Ctrl+Alt+L 编辑")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        toggle(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        request_finish(app, true);
                    }
                })
                .build(app)?;
            if let Err(error) = app
                .global_shortcut()
                .on_shortcut("Ctrl+Alt+L", |app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        let handle = app.clone();
                        let _ = app.run_on_main_thread(move || toggle(&handle));
                    }
                })
            {
                app.state::<AppState>().runtime.lock().unwrap().warning = Some(format!(
                    "Ctrl+Alt+L 注册失败：{error}。请通过托盘进入编辑。"
                ));
            }
            set_mode(app.handle().clone(), false)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                request_finish(window.app_handle(), false);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Life Progress");
}
