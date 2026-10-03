use tauri::Manager;

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
            // Inicia o sidecar da API (backend) automaticamente
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = start_api_sidecar(&handle).await {
                        eprintln!("[sidecar] Falha ao iniciar API sidecar: {}", e);
                    }
                });
            }

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

#[cfg(desktop)]
async fn start_api_sidecar(handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_shell::ShellExt;
    
    let shell = handle.shell();
    
    // Tenta usar sidecar (executável nativo) primeiro
    let sidecar_result = shell.sidecar("api-sidecar");
    
    match sidecar_result {
        Ok(sidecar_command) => {
            let (mut _rx, _child) = sidecar_command.spawn()?;
            println!("[sidecar] API sidecar (native) iniciado com sucesso");
        }
        Err(_) => {
            // Fallback: usa command para rodar o batch file dos resources
            let resource_dir = handle.path().resource_dir()?;
            let batch_path = resource_dir.join("binaries").join("api-sidecar.bat");
            
            let command = shell
                .command("cmd")
                .args(["/C", &batch_path.to_string_lossy().to_string()]);
            let (mut _rx, _child) = command.spawn()?;
            println!("[sidecar] API sidecar (batch launcher) iniciado com sucesso: {}", batch_path.display());
        }
    }
    
    Ok(())
}