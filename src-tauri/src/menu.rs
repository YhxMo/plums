//! The application menu. Its own items are commands for the page: a click is
//! sent as `app-command` with the item's id, and the page maps the same keys
//! itself in the browser preview (`src/shell/app-commands.ts`). The standard
//! items stay AppKit's, so cut, copy and paste reach the WebView.
#[cfg(target_os = "macos")]
use tauri::menu::AboutMetadata;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};
use tauri::{AppHandle, Emitter, Wry};

/// The event the page listens for; its payload is a command id.
const EVENT: &str = "app-command";

/// Id, label and key of each command the page runs.
const COMMANDS: [(&str, &str, &str); 3] = [
    ("settings", "设置…", "CmdOrCtrl+,"),
    ("new", "新建 Agent", "CmdOrCtrl+N"),
    ("find", "搜索 Agent", "CmdOrCtrl+F"),
];

fn is_command(id: &str) -> bool {
    COMMANDS.iter().any(|(known, ..)| *known == id)
}

fn command(app: &AppHandle, id: &str) -> tauri::Result<MenuItem<Wry>> {
    let (id, label, key) = COMMANDS
        .iter()
        .find(|(known, ..)| *known == id)
        .expect("a declared command");
    MenuItem::with_id(app, *id, *label, true, Some(*key))
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let separator = || PredefinedMenuItem::separator(app);
    let settings = command(app, "settings")?;
    let file = Submenu::with_items(
        app,
        "文件",
        true,
        &[
            &command(app, "new")?,
            &separator()?,
            #[cfg(not(target_os = "macos"))]
            &settings,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, Some("退出"))?,
            &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &separator()?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("拷贝"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
            &separator()?,
            &command(app, "find")?,
        ],
    )?;
    let window = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放"))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "显示",
        true,
        &[&PredefinedMenuItem::fullscreen(app, Some("进入全屏幕"))?],
    )?;
    #[cfg(target_os = "macos")]
    let about = AboutMetadata {
        name: Some(app.package_info().name.clone()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        app.package_info().name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, Some("关于 Plums"), Some(about))?,
            &separator()?,
            &settings,
            &separator()?,
            &PredefinedMenuItem::services(app, Some("服务"))?,
            &separator()?,
            &PredefinedMenuItem::hide(app, Some("隐藏 Plums"))?,
            &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
            &separator()?,
            &PredefinedMenuItem::quit(app, Some("退出 Plums"))?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window]);
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&file, &edit, &view, &window]);
    menu
}

pub fn on_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if is_command(id) {
        let _ = app.emit_to("main", EVENT, id);
    }
}

#[cfg(test)]
#[path = "menu_tests.rs"]
mod tests;
