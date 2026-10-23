// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use app_lib::launch::{self, LaunchAction};

/// Print to the parent console. Release builds are GUI-subsystem, so stdout is
/// null unless redirected; attach to the parent console and write to CONOUT$.
#[cfg(windows)]
fn print_out(text: &str) {
    use std::io::Write;
    use windows_sys::Win32::System::Console::{
        AttachConsole, GetStdHandle, ATTACH_PARENT_PROCESS, STD_OUTPUT_HANDLE,
    };
    // SAFETY: plain Win32 calls with constant arguments.
    let (redirected, _) = unsafe {
        let h = GetStdHandle(STD_OUTPUT_HANDLE);
        (!h.is_null() && h as isize != -1, AttachConsole(ATTACH_PARENT_PROCESS))
    };
    if !redirected {
        if let Ok(mut f) = std::fs::OpenOptions::new().write(true).open("CONOUT$") {
            let _ = f.write_all(text.as_bytes());
            return;
        }
    }
    let _ = std::io::stdout().write_all(text.as_bytes());
}

#[cfg(not(windows))]
fn print_out(text: &str) {
    use std::io::Write;
    let _ = std::io::stdout().write_all(text.as_bytes());
}

/// T52-7: from a terminal, re-spawn detached so closing it does not kill the app.
#[cfg(unix)]
fn detach_from_terminal() {
    use std::io::IsTerminal;
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    if !std::io::stdout().is_terminal() || std::env::var_os("GARITA_DETACHED").is_some() {
        return;
    }
    let Ok(exe) = std::env::current_exe() else { return };
    let spawned = Command::new(exe)
        .args(std::env::args_os().skip(1))
        .env("GARITA_DETACHED", "1")
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    if spawned.is_ok() {
        std::process::exit(0);
    } // spawn failed: keep running attached
}

fn main() {
    let argv = launch::os_argv();
    match launch::parse_launch_args(&argv) {
        LaunchAction::PrintHelp => {
            print_out(&launch::help_text());
            return;
        }
        LaunchAction::PrintVersion => {
            print_out(&launch::version_text());
            return;
        }
        LaunchAction::Run(args) => {
            // Launching process only, terminal only, never on Windows (no console attached).
            #[cfg(unix)]
            {
                use std::io::IsTerminal;
                if std::io::stderr().is_terminal() {
                    for t in &args.ignored {
                        eprintln!("{}", launch::ignored_warning(t));
                    }
                }
            }
            #[cfg(not(unix))]
            let _ = args;
        }
    }
    #[cfg(unix)]
    detach_from_terminal();
    app_lib::run()
}
