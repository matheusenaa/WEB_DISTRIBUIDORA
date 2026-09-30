// Evita abrir uma janela de console junto com o app release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    webdist_desktop_lib::run()
}