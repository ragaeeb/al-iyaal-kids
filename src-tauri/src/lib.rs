mod commands;
mod file_discovery;
mod ids;
mod protocol;
mod runtime;
mod state;
mod types;
mod worker;

use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, SubmenuBuilder};
use tauri_plugin_opener::OpenerExt;

use state::AppState;

const GITHUB_MENU_ID: &str = "open-github-repo";
const GITHUB_REPO_URL: &str = "https://github.com/ragaeeb/al-iyaal-kids";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(|app| {
            let pkg = app.package_info();
            let about = AboutMetadataBuilder::new()
                .name(Some(pkg.name.clone()))
                .version(Some(pkg.version.to_string()))
                .credits(Some(format!("GitHub: {GITHUB_REPO_URL}")))
                .build();

            let app_menu = SubmenuBuilder::new(app, pkg.name.clone())
                .about(Some(about))
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .separator()
                .quit()
                .build()?;
            let file_menu = SubmenuBuilder::new(app, "File").close_window().build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;
            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&MenuItem::with_id(
                    app,
                    GITHUB_MENU_ID,
                    "GitHub Repository",
                    true,
                    None::<&str>,
                )?)
                .build()?;

            Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu, &help_menu])
        })
        .on_menu_event(|app, event| {
            if event.id() == GITHUB_MENU_ID {
                let _ = app.opener().open_url(GITHUB_REPO_URL, None::<&str>);
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::start_batch,
            commands::cancel_batch,
            commands::get_batch_state,
            commands::open_folder_picker,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
