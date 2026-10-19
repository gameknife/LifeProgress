mod data;
use data::{AppData, DisplayScale, Orientation, Position};
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WindowEvent,
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
fn save_data(app: AppHandle, state: State<AppState>, mut data: AppData) -> Result<AppData, String> {
    let mut runtime = state.runtime.lock().map_err(|e| e.to_string())?;
    if runtime.load_error.is_some() {
        return Err("原数据无法读取，请先使用恢复按钮；不会覆盖原文件。".into());
    }
    data::validate(&data)?;
    let resize = data.orientation != runtime.data.orientation
        || data.display_scale != runtime.data.display_scale;
    if resize || data.centered {
        place_window(&app, &data, resize)?;
    }
    if let Some(window) = app.get_webview_window("main") {
        let p = window.outer_position().map_err(|e| e.to_string())?;
        data.position = Some(Position { x: p.x, y: p.y });
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
    if !interactive && runtime.data.centered {
        place_window(&app, &runtime.data, false)?;
    }
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

fn place_window(app: &AppHandle, data: &AppData, resize: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("找不到主窗口")?;
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let saved = data.position.as_ref().filter(|_| !data.centered);
    let saved_monitor = saved
        .and_then(|p| {
            monitors.iter().find(|m| {
                let area = m.work_area();
                p.x >= area.position.x
                    && p.x < area.position.x + area.size.width as i32
                    && p.y >= area.position.y
                    && p.y < area.position.y + area.size.height as i32
            })
        })
        .cloned();
    if let Some(monitor) = saved_monitor
        .or(window.current_monitor().map_err(|e| e.to_string())?)
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
    {
        let area = monitor.work_area();
        if resize {
            let size = display_size(
                data.orientation,
                data.display_scale,
                monitor.scale_factor(),
                area.size,
            );
            window.set_size(size).map_err(|e| e.to_string())?;
        }
        // Position with actual outer bounds; set_size takes client bounds and must
        // never run during a mode-only transition.
        let current_size = window.outer_size().map_err(|e| e.to_string())?;
        let width = current_size.width.min(area.size.width);
        let height = current_size.height.min(area.size.height);
        let right = area.position.x + area.size.width as i32 - width as i32;
        let bottom = area.position.y + area.size.height as i32 - height as i32;
        let x = saved
            .map(|p| p.x)
            .unwrap_or(area.position.x + (area.size.width as i32 - width as i32) / 2)
            .clamp(area.position.x, right);
        let y = saved
            .map(|p| p.y)
            .unwrap_or(area.position.y + (area.size.height as i32 - height as i32) / 2)
            .clamp(area.position.y, bottom);
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn display_size(
    orientation: Orientation,
    display_scale: DisplayScale,
    dpi: f64,
    area: PhysicalSize<u32>,
) -> PhysicalSize<u32> {
    let (base_width, base_height) = match orientation {
        Orientation::Horizontal => (920.0 * dpi, 640.0 * dpi),
        Orientation::Vertical => (520.0 * dpi, 920.0 * dpi),
    };
    // Fit the largest preset first so all three remain distinct on small screens.
    let fit = ((area.width.saturating_sub(48).max(1) as f64) / (base_width * 1.5))
        .min((area.height.saturating_sub(48).max(1) as f64) / (base_height * 1.5))
        .min(1.0);
    PhysicalSize::new(
        (base_width * fit * display_scale.factor()).round() as u32,
        (base_height * fit * display_scale.factor()).round() as u32,
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
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
            place_window(app.handle(), &data, true)?;
            app.manage(AppState {
                path,
                runtime: Mutex::new(Runtime {
                    data,
                    load_error,
                    warning: None,
                    interactive: false,
                }),
            });
            let menu = MenuBuilder::new(app)
                .text("edit", "编辑 / 返回静默  Ctrl+Alt+L")
                .text("reset", "窗口居中")
                .text("quit", "保存并退出")
                .build()?;
            // Paint each dot directly into the 32×32 tray icon.
            let mut rgba = vec![0u8; 32 * 32 * 4];
            for row in 0..4 {
                for col in 0..4 {
                    for dy in -2i32..=2 {
                        for dx in -2i32..=2 {
                            if dx * dx + dy * dy <= 4 {
                                let x = 5 + col * 7 + dx;
                                let y = 5 + row * 7 + dy;
                                let i = ((y * 32 + x) * 4) as usize;
                                rgba[i..i + 4].copy_from_slice(if row == 2 && col == 1 {
                                    &[239, 68, 68, 255]
                                } else {
                                    &[229, 229, 229, 255]
                                });
                            }
                        }
                    }
                }
            }
            TrayIconBuilder::with_id("life-progress")
                .icon(tauri::image::Image::new_owned(rgba, 32, 32))
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
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "edit" => toggle(app),
                    "reset" => {
                        let data = AppData {
                            centered: true,
                            ..app.state::<AppState>().runtime.lock().unwrap().data.clone()
                        };
                        if let Err(error) = place_window(app, &data, false) {
                            eprintln!("{error}");
                        }
                    }
                    "quit" => request_finish(app, true),
                    _ => {}
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
