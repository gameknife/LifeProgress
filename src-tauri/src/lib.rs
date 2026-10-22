mod data;

use data::{AppData, DisplayScale};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering::Relaxed},
};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct AppState {
    path: PathBuf,
    interactive: AtomicBool,
}

#[tauri::command]
fn load_data(state: State<AppState>) -> (AppData, bool) {
    (data::read(&state.path), state.interactive.load(Relaxed))
}

#[tauri::command]
fn save_data(state: State<AppState>, data: AppData) -> tauri::Result<()> {
    Ok(data::write(&state.path, &data)?)
}

#[tauri::command]
fn set_mode(app: AppHandle, interactive: bool) -> tauri::Result<()> {
    let window = main_window(&app);
    if interactive {
        #[cfg(target_os = "macos")]
        app.show()?;
        window.set_always_on_bottom(false)?;
        window.set_ignore_cursor_events(false)?;
        window.unminimize()?;
        window.show()?;
        // ShowWindow / restore can reset z-order during a hidden first launch.
        window.set_always_on_top(true)?;
        window.set_focus()?;
    } else {
        // Release the foreground before enabling click-through.
        window.set_always_on_top(false)?;
        window.set_always_on_bottom(true)?;
        window.set_ignore_cursor_events(true)?;
        window.show()?;
    }
    app.state::<AppState>()
        .interactive
        .store(interactive, Relaxed);
    app.emit("mode-changed", interactive)
}

#[tauri::command]
fn set_scale(window: WebviewWindow, scale: DisplayScale) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()? else {
        return Ok(());
    };
    let area = monitor.work_area();
    let (width, height) = (area.size.width as f64, area.size.height as f64);
    let factor = match scale {
        DisplayScale::Small => 1.0,
        DisplayScale::Medium => 1.25,
        DisplayScale::Large => 1.5,
    };
    // Shrink by the large preset's fit so all three stay distinct on smaller screens.
    let unit = ((width - 48.0) / 1380.0)
        .min((height - 48.0) / 960.0)
        .min(monitor.scale_factor())
        * factor;
    let size = PhysicalSize::new(920.0 * unit, 640.0 * unit);
    window.set_size(size)?;
    // Center from the target size: macOS applies the resize asynchronously.
    window.set_position(PhysicalPosition::new(
        area.position.x as f64 + (width - size.width) / 2.0,
        area.position.y as f64 + (height - size.height) / 2.0,
    ))
}

#[tauri::command]
fn cursor_position(window: WebviewWindow) -> tauri::Result<(f64, f64)> {
    let cursor = window.cursor_position()?;
    let origin = window.inner_position()?;
    let dpi = window.scale_factor()?;
    Ok((
        (cursor.x - origin.x as f64) / dpi,
        (cursor.y - origin.y as f64) / dpi,
    ))
}

#[tauri::command]
fn begin_drag(window: WebviewWindow) -> tauri::Result<()> {
    window.start_dragging()
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn main_window(app: &AppHandle) -> WebviewWindow {
    app.get_webview_window("main").unwrap()
}

fn is_interactive(app: &AppHandle) -> bool {
    app.state::<AppState>().interactive.load(Relaxed)
}

fn edit(app: &AppHandle) {
    let _ = set_mode(app.clone(), true);
}

/// The WebView saves its draft before leaving; a silent window has nothing to save.
fn finish(app: &AppHandle, quit: bool) {
    if quit && !is_interactive(app) {
        app.exit(0);
    } else {
        let _ = app.emit("finish-editing", quit);
    }
}

/// The hotkey closes the editor only when it is in front; otherwise it brings the editor back.
fn toggle(app: &AppHandle) {
    let window = main_window(app);
    let in_front = window.is_visible().unwrap_or(false)
        && window.is_focused().unwrap_or(false)
        && !window.is_minimized().unwrap_or(true);
    if in_front && is_interactive(app) {
        finish(app, false);
    } else {
        edit(app);
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| edit(app)))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            set_mode,
            set_scale,
            cursor_position,
            begin_drag,
            quit_app
        ])
        .setup(|app| {
            // Native QA may isolate its data in debug builds; release builds always use app data.
            let dir = match std::env::var_os("LIFE_PROGRESS_DATA_DIR") {
                Some(dir) if cfg!(debug_assertions) => PathBuf::from(dir),
                _ => app.path().app_data_dir()?,
            };
            let path = dir.join("milestones.json");
            set_scale(main_window(app.handle()), data::read(&path).display_scale)?;
            app.manage(AppState {
                path,
                interactive: AtomicBool::new(false),
            });
            let hotkey = app
                .global_shortcut()
                .on_shortcut("Ctrl+Alt+L", |app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        let handle = app.clone();
                        let _ = app.run_on_main_thread(move || toggle(&handle));
                    }
                });
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                // A taken hotkey is not fatal: the tray always reaches the editor.
                .tooltip(match hotkey {
                    Ok(_) => "Life Progress · Ctrl+Alt+L 编辑",
                    Err(_) => "Life Progress · 点击编辑",
                })
                .menu(
                    &MenuBuilder::new(app)
                        .text("edit", "显示并编辑")
                        .text("quit", "保存并退出")
                        .build()?,
                )
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        edit(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => finish(app, true),
                    _ => edit(app),
                })
                .build(app)?;
            Ok(set_mode(app.handle().clone(), false)?)
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                finish(window.app_handle(), false);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Life Progress");
}
