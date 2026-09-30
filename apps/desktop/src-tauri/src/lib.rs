use tauri::Manager;
use tauri_plugin_single_instance::SingleInstanceAppExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Evita abrir duas copias do app: a segunda instancia apenas foca a
        // janela existente. Sem isso, dois processos escreveriam no mesmo
        // banco ao mesmo tempo.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // Lembra tamanho e posicao da janela entre sessoes.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Garante o nome comercial na barra de titulo e no Gerenciador
            // de Tarefas, independente do titulo do config.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("WEB DISTRIBUIDORA");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("falha ao iniciar o aplicativo desktop");
}