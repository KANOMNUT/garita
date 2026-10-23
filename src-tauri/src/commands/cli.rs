//! Command-line launcher status and macOS install (R2c, A5/K11/K12 of `docs/impl/v2.1.3-tasks.md`).
//!
//! **App-local commands: no `context`.** Decisions are pure functions over a `Probe`; the
//! filesystem and registry reads below are thin shims. Nothing here shells out or escalates.

use crate::launch::CLI_COMMAND_NAME;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CliStatus {
    /// "symlink" | "package" | "installer" | "manual"
    pub method: String,
    pub on_path: bool,
    pub resolved_path: Option<String>,
    pub manual_command: Option<String>,
}

// Variants are built per-OS; the decision logic is compiled (and tested) everywhere.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Os {
    Mac,
    Linux,
    Windows,
}

#[derive(Debug, Clone)]
pub struct Probe {
    pub os: Os,
    /// Canonical `current_exe()` (no `\\?\` prefix on Windows).
    pub exe: String,
    /// Canonical `$APPIMAGE` (Linux only).
    pub appimage: Option<String>,
    /// The entry named `garita` (`garita.exe` on Windows) found on PATH / in /usr/local/bin.
    pub found: Option<String>,
    /// Canonical target of `found`; `None` when dangling.
    pub found_target: Option<String>,
    /// macOS: `/usr/local/bin` exists.
    pub local_bin_exists: bool,
    /// macOS: the existing `/usr/local/bin/garita` is a symlink.
    pub link_is_symlink: bool,
}

/// Single-quote for a copyable shell line (no `!` history expansion, `$` or backtick surprises).
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

const MAC_LINK: &str = "/usr/local/bin/garita";

pub fn decide_status(p: &Probe) -> CliStatus {
    let n = CLI_COMMAND_NAME;
    let resolved_path = p.found.clone();
    match p.os {
        Os::Mac => {
            let on_path = p.found_target.as_deref() == Some(p.exe.as_str());
            let ln = if p.link_is_symlink { "ln -sfh" } else { "ln -s" };
            let mkdir = if p.local_bin_exists { "" } else { "sudo mkdir -p /usr/local/bin && " };
            CliStatus {
                method: "symlink".into(),
                on_path,
                resolved_path,
                manual_command: Some(format!("{mkdir}sudo {ln} {} {MAC_LINK}", sh_quote(&p.exe))),
            }
        }
        Os::Linux => match &p.appimage {
            None => CliStatus {
                method: "package".into(),
                on_path: p.found_target.as_deref() == Some(p.exe.as_str()),
                resolved_path,
                manual_command: None,
            },
            Some(img) => CliStatus {
                method: "manual".into(),
                on_path: p.found_target.as_deref() == Some(img.as_str()),
                resolved_path,
                manual_command: Some(format!("ln -s {} ~/.local/bin/{n}", sh_quote(img))),
            },
        },
        Os::Windows => {
            let on_path = p.found.is_some();
            CliStatus {
                method: "installer".into(),
                on_path,
                resolved_path,
                manual_command: if on_path { None } else { Some(parent_dir(&p.exe)) },
            }
        }
    }
}

/// Folder of a path, splitting on either separator (pure, host-independent).
pub fn parent_dir(path: &str) -> String {
    match path.rfind(['/', '\\']) {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

/// Drop the `\\?\` verbatim prefix `fs::canonicalize` adds on Windows.
pub fn strip_verbatim(p: &str) -> String {
    if let Some(r) = p.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{r}")
    } else {
        p.strip_prefix(r"\\?\").unwrap_or(p).to_string()
    }
}

/// Expand `%VAR%` using `lookup`; unknown variables and unmatched `%` stay as written.
#[cfg_attr(not(windows), allow(dead_code))] // Windows registry PATH only; tested everywhere
pub fn expand_env(s: &str, lookup: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) => match lookup(&after[..j]) {
                Some(v) if j > 0 => {
                    out.push_str(&v);
                    rest = &after[j + 1..];
                }
                _ => {
                    out.push('%');
                    rest = after;
                }
            },
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

// ─── macOS install: pure plan ────────────────────────────────────────────────

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, PartialEq)]
pub enum EntryState {
    Absent,
    Symlink { target: String, live: bool },
    Other,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum InstallPlan {
    Create,
    Replace,
}

#[cfg(any(target_os = "macos", test))]
pub fn plan_install(exe: &str, read_only: bool, entry: &EntryState) -> Result<InstallPlan, String> {
    if read_only || exe.contains("/AppTranslocation/") {
        return Err("Failed to install command: Garita is running from a temporary location. \
Move Garita to Applications, reopen it, and try again."
            .into());
    }
    let foreign = || {
        Err(format!(
            "Failed to install command: {MAC_LINK} already exists and is not Garita's link"
        ))
    };
    match entry {
        EntryState::Absent => Ok(InstallPlan::Create),
        EntryState::Other => foreign(),
        EntryState::Symlink { target, live } => {
            if *live && !target.ends_with("/Contents/MacOS/garita") {
                foreign()
            } else {
                Ok(InstallPlan::Replace)
            }
        }
    }
}

// ─── thin I/O shims ──────────────────────────────────────────────────────────

fn canon(p: &std::path::Path) -> Option<String> {
    std::fs::canonicalize(p)
        .ok()
        .map(|c| strip_verbatim(&c.to_string_lossy()))
}

#[cfg(windows)]
fn reg_path(hive: windows_sys::Win32::System::Registry::HKEY, sub: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::*;
    let sub16: Vec<u16> = sub.encode_utf16().chain([0]).collect();
    let name16: Vec<u16> = "Path".encode_utf16().chain([0]).collect();
    // SAFETY: NUL-terminated buffers outlive the calls; sizes come from the API itself.
    unsafe {
        let mut key: HKEY = std::ptr::null_mut();
        if RegOpenKeyExW(hive, sub16.as_ptr(), 0, KEY_READ, &mut key) != 0 {
            return None;
        }
        let (mut ty, mut len) = (0u32, 0u32);
        let mut out = None;
        let probe = RegQueryValueExW(
            key, name16.as_ptr(), std::ptr::null(), &mut ty, std::ptr::null_mut(), &mut len,
        );
        if probe == 0 && (ty == REG_SZ || ty == REG_EXPAND_SZ) && len > 0 {
            let mut buf = vec![0u16; len as usize / 2 + 2];
            let mut len2 = (buf.len() * 2) as u32;
            let r = RegQueryValueExW(
                key, name16.as_ptr(), std::ptr::null(), &mut ty,
                buf.as_mut_ptr() as *mut u8, &mut len2,
            );
            if r == 0 {
                let n = (len2 as usize / 2).min(buf.len());
                out = Some(String::from_utf16_lossy(&buf[..n]).trim_end_matches('\0').to_string());
            }
        }
        RegCloseKey(key);
        out
    }
}

#[cfg(windows)]
fn windows_dirs() -> Vec<std::path::PathBuf> {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    let lookup = |k: &str| std::env::var(k).ok();
    let mut raw: Vec<String> = Vec::new();
    for (hive, sub) in [
        (HKEY_CURRENT_USER, "Environment"),
        (HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
    ] {
        if let Some(v) = reg_path(hive, sub) {
            raw.extend(
                v.split(';')
                    .map(|s| s.trim_matches('"'))
                    .filter(|s| !s.is_empty())
                    .map(|s| expand_env(s, &lookup)),
            );
        }
    }
    let mut dirs: Vec<_> = raw.into_iter().map(std::path::PathBuf::from).collect();
    if let Some(p) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&p));
    }
    dirs
}

fn current_probe() -> Result<Probe, String> {
    let exe_raw = std::env::current_exe().map_err(|e| format!("Failed to locate the app: {}", e))?;
    let exe = canon(&exe_raw).ok_or("Failed to locate the app: cannot resolve its path")?;
    let name = CLI_COMMAND_NAME;

    #[cfg(windows)]
    {
        let file = format!("{name}.exe");
        let found = windows_dirs().into_iter().map(|d| d.join(&file)).find(|f| f.is_file());
        Ok(Probe {
            os: Os::Windows,
            exe,
            appimage: None,
            found: found.as_ref().map(|f| f.to_string_lossy().into_owned()),
            found_target: None,
            local_bin_exists: false,
            link_is_symlink: false,
        })
    }

    #[cfg(not(windows))]
    {
        let mut dirs: Vec<std::path::PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        let mac = cfg!(target_os = "macos");
        if mac {
            dirs.push("/usr/local/bin".into());
        }
        // An entry that exists even if dangling (stale link must still be reported).
        let found = dirs
            .iter()
            .map(|d| d.join(name))
            .find(|f| std::fs::symlink_metadata(f).is_ok());
        let link = std::path::Path::new(MAC_LINK);
        Ok(Probe {
            os: if mac { Os::Mac } else { Os::Linux },
            exe,
            appimage: std::env::var_os("APPIMAGE").and_then(|a| canon(std::path::Path::new(&a))),
            found_target: found.as_deref().and_then(canon),
            found: found.map(|f| f.to_string_lossy().into_owned()),
            local_bin_exists: std::path::Path::new("/usr/local/bin").is_dir(),
            link_is_symlink: std::fs::symlink_metadata(link)
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false),
        })
    }
}

#[tauri::command]
pub async fn get_cli_status() -> Result<CliStatus, String> {
    tauri::async_runtime::spawn_blocking(|| current_probe().map(|p| decide_status(&p)))
        .await
        .map_err(|e| format!("Failed to check command: {}", e))?
}

#[cfg(target_os = "macos")]
fn volume_read_only(p: &str) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c) = std::ffi::CString::new(std::ffi::OsStr::new(p).as_bytes()) else { return false };
    // SAFETY: `c` is NUL-terminated; `s` is a zeroed plain-data out struct.
    unsafe {
        let mut s: libc::statfs = std::mem::zeroed();
        libc::statfs(c.as_ptr(), &mut s) == 0 && (s.f_flags & libc::MNT_RDONLY as u32) != 0
    }
}

#[cfg(target_os = "macos")]
fn entry_state() -> EntryState {
    let link = std::path::Path::new(MAC_LINK);
    match std::fs::symlink_metadata(link) {
        Err(_) => EntryState::Absent,
        Ok(m) if m.file_type().is_symlink() => EntryState::Symlink {
            target: std::fs::read_link(link)
                .map(|t| t.to_string_lossy().into_owned())
                .unwrap_or_default(),
            live: link.exists(),
        },
        Ok(_) => EntryState::Other,
    }
}

/// macOS only: symlink `/usr/local/bin/garita` to this app's binary. No privilege escalation.
#[tauri::command]
pub async fn install_cli_command() -> Result<CliStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let probe = current_probe()?;
        let plan = plan_install(&probe.exe, volume_read_only(&probe.exe), &entry_state())?;
        let link = std::path::Path::new(MAC_LINK);
        if plan == InstallPlan::Replace {
            if let Err(e) = std::fs::remove_file(link) {
                return denied_or_err(e, probe);
            }
        }
        match std::os::unix::fs::symlink(&probe.exe, link) {
            Ok(()) => current_probe().map(|p| decide_status(&p)),
            Err(e) => denied_or_err(e, probe),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Failed to install command: not supported on this platform".into())
    }
}

/// Permission denied / missing directory is not a failure: hand back the manual command.
#[cfg(target_os = "macos")]
fn denied_or_err(e: std::io::Error, probe: Probe) -> Result<CliStatus, String> {
    use std::io::ErrorKind::{NotFound, PermissionDenied};
    match e.kind() {
        PermissionDenied | NotFound => Ok(decide_status(&probe)),
        _ => Err(format!("Failed to install command: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "/Applications/Garita.app/Contents/MacOS/garita";

    fn mac(found: Option<&str>, target: Option<&str>, bin: bool, sym: bool) -> Probe {
        Probe {
            os: Os::Mac,
            exe: EXE.into(),
            appimage: None,
            found: found.map(Into::into),
            found_target: target.map(Into::into),
            local_bin_exists: bin,
            link_is_symlink: sym,
        }
    }

    #[test]
    fn mac_installed_link() {
        let s = decide_status(&mac(Some("/usr/local/bin/garita"), Some(EXE), true, true));
        assert!(s.on_path);
        assert_eq!(s.method, "symlink");
        assert_eq!(s.resolved_path.as_deref(), Some("/usr/local/bin/garita"));
        assert_eq!(
            s.manual_command.as_deref(),
            Some("sudo ln -sfh '/Applications/Garita.app/Contents/MacOS/garita' /usr/local/bin/garita")
        );
    }

    #[test]
    fn mac_absent_no_dir_has_mkdir_prefix() {
        let s = decide_status(&mac(None, None, false, false));
        assert!(!s.on_path && s.resolved_path.is_none());
        assert_eq!(
            s.manual_command.as_deref(),
            Some("sudo mkdir -p /usr/local/bin && sudo ln -s '/Applications/Garita.app/Contents/MacOS/garita' /usr/local/bin/garita")
        );
    }

    #[test]
    fn mac_stale_and_foreign() {
        // dangling link: resolved but not on path, -sf over a link
        let s = decide_status(&mac(Some("/usr/local/bin/garita"), None, true, true));
        assert!(!s.on_path);
        assert!(s.resolved_path.is_some());
        assert!(s.manual_command.unwrap().contains("ln -sfh"));
        // regular file: plain ln -s (never -sfh over a regular file)
        let s = decide_status(&mac(Some("/usr/local/bin/garita"), Some("/usr/local/bin/garita"), true, false));
        assert!(!s.on_path);
        assert!(s.manual_command.unwrap().contains("ln -s '"));
    }

    #[test]
    fn mac_homebrew_link_reads_installed() {
        let s = decide_status(&mac(Some("/opt/homebrew/bin/garita"), Some(EXE), true, false));
        assert!(s.on_path);
        assert_eq!(s.resolved_path.as_deref(), Some("/opt/homebrew/bin/garita"));
    }

    fn linux(appimage: Option<&str>, target: Option<&str>) -> Probe {
        Probe {
            os: Os::Linux,
            exe: "/usr/bin/garita".into(),
            appimage: appimage.map(Into::into),
            found: target.map(|_| "/usr/bin/garita".to_string()),
            found_target: target.map(Into::into),
            local_bin_exists: false,
            link_is_symlink: false,
        }
    }

    #[test]
    fn linux_package() {
        let s = decide_status(&linux(None, Some("/usr/bin/garita")));
        assert_eq!((s.method.as_str(), s.on_path), ("package", true));
        assert!(s.manual_command.is_none());
        let s = decide_status(&linux(None, None));
        assert!(!s.on_path && s.resolved_path.is_none() && s.manual_command.is_none());
        let s = decide_status(&linux(None, Some("/opt/other/garita")));
        assert!(!s.on_path && s.resolved_path.is_some());
    }

    #[test]
    fn linux_appimage() {
        let img = "/home/u/Apps/Garita x.AppImage";
        let s = decide_status(&linux(Some(img), Some(img)));
        assert_eq!((s.method.as_str(), s.on_path), ("manual", true));
        assert_eq!(
            s.manual_command.as_deref(),
            Some("ln -s '/home/u/Apps/Garita x.AppImage' ~/.local/bin/garita")
        );
        assert!(!decide_status(&linux(Some(img), Some("/usr/bin/garita"))).on_path);
    }

    #[test]
    fn windows_rows() {
        let mut p = Probe {
            os: Os::Windows,
            exe: r"C:\Program Files\Garita\garita.exe".into(),
            appimage: None,
            found: Some(r"C:\Program Files\Garita\garita.exe".into()),
            found_target: None,
            local_bin_exists: false,
            link_is_symlink: false,
        };
        let s = decide_status(&p);
        assert_eq!((s.method.as_str(), s.on_path), ("installer", true));
        assert!(s.manual_command.is_none());
        p.found = None;
        let s = decide_status(&p);
        assert!(!s.on_path && s.resolved_path.is_none());
        assert_eq!(s.manual_command.as_deref(), Some(r"C:\Program Files\Garita"));
    }

    #[test]
    fn helpers() {
        assert_eq!(sh_quote("a'b!$c\"d"), r#"'a'\''b!$c"d'"#);
        assert_eq!(strip_verbatim(r"\\?\C:\x"), r"C:\x");
        assert_eq!(strip_verbatim(r"\\?\UNC\srv\sh\x"), r"\\srv\sh\x");
        assert_eq!(strip_verbatim("/a/b"), "/a/b");
        assert_eq!(parent_dir("/a/b/c"), "/a/b");
        assert_eq!(parent_dir("nofolder"), "");
        let l = |k: &str| (k == "USERPROFILE").then(|| r"C:\Users\u".to_string());
        assert_eq!(expand_env(r"%USERPROFILE%\bin", &l), r"C:\Users\u\bin");
        assert_eq!(expand_env(r"%NOPE%\bin", &l), r"%NOPE%\bin");
        assert_eq!(expand_env("50%", &l), "50%");
        assert_eq!(expand_env("%%x", &l), "%%x");
    }

    #[test]
    fn install_plan() {
        let live = |t: &str| EntryState::Symlink { target: t.into(), live: true };
        assert_eq!(plan_install(EXE, false, &EntryState::Absent), Ok(InstallPlan::Create));
        assert_eq!(plan_install(EXE, false, &live(EXE)), Ok(InstallPlan::Replace));
        // dangling, any target: replaced
        let dang = EntryState::Symlink { target: "/gone".into(), live: false };
        assert_eq!(plan_install(EXE, false, &dang), Ok(InstallPlan::Replace));
        // live link elsewhere, and a regular file: foreign
        for e in [live("/usr/bin/other"), EntryState::Other] {
            let err = plan_install(EXE, false, &e).unwrap_err();
            assert_eq!(
                err,
                "Failed to install command: /usr/local/bin/garita already exists and is not Garita's link"
            );
        }
        // K12
        let t = "/private/var/folders/x/AppTranslocation/ABC/d/Garita.app/Contents/MacOS/garita";
        assert!(plan_install(t, false, &EntryState::Absent).unwrap_err().contains("temporary location"));
        assert!(plan_install(EXE, true, &EntryState::Absent).unwrap_err().contains("temporary location"));
    }
}
