use std::sync::Mutex;
use tauri::Manager;

/// Processo da API local. Guardado no estado do app para que o handle viva
/// enquanto a janela existir. O `job` e um Job Object do Windows: enquanto o
/// app estiver vivo ele mantem a arvore da API protegida, e quando o app morre
/// (inclusive por crash ou "Finalizar tarefa") o SO encerra os filhos.
#[cfg(desktop)]
struct Sidecar {
    child: Mutex<Option<std::process::Child>>,
    #[cfg(windows)]
    job: Mutex<Option<windows_job::Job>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
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
        // Mantido para o frontend abrir links externos (WhatsApp, relatorios).
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                match start_api_sidecar(app.handle()) {
                    Ok(started) => {
                        #[cfg(windows)]
                        {
                            app.manage(Sidecar {
                                child: Mutex::new(Some(started.child)),
                                job: Mutex::new(started.job),
                            });
                        }
                        #[cfg(not(windows))]
                        {
                            app.manage(Sidecar {
                                child: Mutex::new(Some(started.child)),
                            });
                        }
                    }
                    Err(e) => {
                        let erro = format!("Falha ao iniciar a API local: {}", e);
                        log_line(&erro);
                        eprintln!("[sidecar] {}", erro);
                    }
                }
            }

            // Garante o nome comercial na barra de titulo e no Gerenciador
            // de Tarefas, independente do titulo do config.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("WEB DISTRIBUIDORA");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("falha ao iniciar o aplicativo desktop");

    app.run(|handle, event| {
        // Sem isto a API continuaria rodando depois de fechar o app,
        // segurando a porta 3333 e o banco aberto.
        #[cfg(desktop)]
        if let tauri::RunEvent::Exit = event {
            stop_api_sidecar(handle);
        }
        let _ = (handle, event);
    });
}

/// Pasta de dados do usuario: banco, `.env`, backups e logs.
#[cfg(desktop)]
fn data_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("APPDATA")
        .map(std::path::PathBuf::from)
        .map(|base| base.join("WEB DISTRIBUIDORA"))
}

/// Log em arquivo: o app e compilado sem console, entao `eprintln!` seria
/// descartado e nenhuma falha de inicializacao seria visivel.
#[cfg(desktop)]
fn log_line(message: &str) {
    use std::io::Write;
    if let Some(dir) = data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("desktop.log"))
        {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let _ = writeln!(file, "[{}] {}", now, message);
        }
    }
}

/// O `resource_dir` do Tauri devolve caminho verbatim (`\\?\C:\...`). O
/// `cmd.exe` nao entende esse prefixo e sairia com "arquivo nao encontrado",
/// entao o prefixo e removido antes de montar o comando.
#[cfg(desktop)]
fn strip_verbatim_prefix(path: &std::path::Path) -> std::path::PathBuf {
    let text = path.to_string_lossy().to_string();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => std::path::PathBuf::from(rest),
        Some(rest) => std::path::PathBuf::from(format!(r"\\{}", rest.trim_start_matches("UNC\\"))),
        None => path.to_path_buf(),
    }
}

/// FFI direto para o Job Object do Windows.
///
/// Usamos `winapi`/`windows` em vez de C novas dependencias: sao tres funcoes e
/// duas structs, e nao vale arrastar uma crate para o bundle do instalador.
#[cfg(windows)]
mod windows_job {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;

    type Handle = *mut c_void;
    type Dword = u32;
    type UlongPtr = usize;

    #[repr(C)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: Dword,
        minimum_working_set_size: UlongPtr,
        maximum_working_set_size: UlongPtr,
        active_process_limit: Dword,
        affinity: UlongPtr,
        priority_class: Dword,
        scheduling_class: Dword,
    }

    #[repr(C)]
    struct ExtendedLimitInformation {
        basic_limit_information: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: UlongPtr,
        job_memory_limit: UlongPtr,
        peak_process_memory_used: UlongPtr,
        peak_job_memory_used: UlongPtr,
    }

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
    /// Mata todos os processos do job quando o ultimo handle e fechado.
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: Dword = 0x0000_2000;

    extern "system" {
        fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(
            job: Handle,
            info_class: i32,
            info: *mut c_void,
            length: Dword,
        ) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn CloseHandle(object: Handle) -> i32;
    }

    /// Handle de Job Object. Fechar o handle encerra a arvore de processos.
    pub struct Job(Handle);

    impl Job {
        pub fn kill_on_close() -> Option<Self> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
                if job.is_null() {
                    return None;
                }

                let mut info = ExtendedLimitInformation {
                    basic_limit_information: BasicLimitInformation {
                        per_process_user_time_limit: 0,
                        per_job_user_time_limit: 0,
                        limit_flags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                        minimum_working_set_size: 0,
                        maximum_working_set_size: 0,
                        active_process_limit: 0,
                        affinity: 0,
                        priority_class: 0,
                        scheduling_class: 0,
                    },
                    io_info: IoCounters {
                        read_operation_count: 0,
                        write_operation_count: 0,
                        other_operation_count: 0,
                        read_transfer_count: 0,
                        write_transfer_count: 0,
                        other_transfer_count: 0,
                    },
                    process_memory_limit: 0,
                    job_memory_limit: 0,
                    peak_process_memory_used: 0,
                    peak_job_memory_used: 0,
                };

                let ok = SetInformationJobObject(
                    job,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    &mut info as *mut _ as *mut c_void,
                    std::mem::size_of::<ExtendedLimitInformation>() as Dword,
                );
                if ok == 0 {
                    CloseHandle(job);
                    return None;
                }

                Some(Job(job))
            }
        }

        /// Coloca o processo e todos os filhos futuros no job.
        pub fn assign(&self, process: &std::process::Child) -> bool {
            unsafe {
                AssignProcessToJobObject(
                    self.0,
                    process.as_raw_handle() as Handle,
                ) != 0
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    // O handle e guardado dentro de `Mutex`, entao todo acesso ja e
    // serializado e o Tauri exige `Send + Sync` para o estado gerenciado.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}
}

/// Resultado do start: o processo e, no Windows, o Job Object que o protege.
#[cfg(desktop)]
struct Started {
    child: std::process::Child,
    #[cfg(windows)]
    job: Option<windows_job::Job>,
}

/// Cria um Job Object que so existe enquanto o app estiver vivo.
#[cfg(windows)]
fn create_job() -> Option<windows_job::Job> {
    windows_job::Job::kill_on_close()
}

/// Inicia a API local a partir do launcher empacotado.
///
/// Usamos `std::process::Command` em vez do plugin shell porque o
/// `CommandChild` do plugin e destruido junto com o handle ao fim do
/// `spawn`, o que encerrava a API imediatamente.
#[cfg(desktop)]
fn start_api_sidecar(
    handle: &tauri::AppHandle,
) -> Result<Started, Box<dyn std::error::Error>> {
    let resource_dir = strip_verbatim_prefix(&handle.path().resource_dir()?);
    let batch_path = resource_dir.join("binaries").join("api-sidecar.bat");

    log_line(&format!("resource_dir: {}", resource_dir.display()));
    log_line(&format!("launcher: {}", batch_path.display()));

    if !batch_path.exists() {
        let erro = format!("launcher da API ausente em {}", batch_path.display());
        log_line(&erro);
        return Err(erro.into());
    }

    let mut command = std::process::Command::new("cmd");
    command
        .arg("/C")
        .arg(&batch_path)
        .current_dir(batch_path.parent().unwrap_or(&resource_dir))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    // Evita abrir uma janela de console junto com o app.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    match command.spawn() {
        Ok(child) => {
            log_line(&format!("API iniciada (pid {})", child.id()));

            #[cfg(windows)]
            let job = create_job().and_then(|job| {
                if job.assign(&child) {
                    Some(job)
                } else {
                    log_line("aviso: nao foi possivel associar a API ao Job Object");
                    None
                }
            });

            Ok(Started { child, job })
        }
        Err(e) => {
            log_line(&format!("falha ao spawnar a API: {}", e));
            Err(Box::new(e))
        }
    }
}

/// Encerra a API e todo o seu processo filho.
#[cfg(desktop)]
fn stop_api_sidecar(handle: &tauri::AppHandle) {
    let Some(sidecar) = handle.try_state::<Sidecar>() else {
        return;
    };
    let Ok(mut guard) = sidecar.child.lock() else {
        return;
    };
    let Some(mut child) = guard.take() else {
        return;
    };

    // O launcher e um `cmd` que fica waiting pelo node; matar apenas o cmd
    // deixaria o node vivo. `/T` derruba a arvore inteira.
    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .and_then(|mut kill| kill.wait());

    #[cfg(not(windows))]
    let _ = child.kill();

    // Fechar o Job Object tambem derruba a arvore, como rede de seguranca
    // para o caso de o `taskkill` falhar.
    #[cfg(windows)]
    {
        let job = sidecar.job.lock().ok().and_then(|mut guard| guard.take());
        drop(job);
    }
}