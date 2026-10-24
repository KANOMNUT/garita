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
    /// A line for the user's shell profile that puts the folder of `manual_command` on PATH.
    /// Shown, never written.
    pub path_hint: Option<String>,
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
    /// macOS: a per-user bin folder that exists and is on PATH (`user_bin`).
    pub user_bin: Option<String>,
    /// macOS: the user can write `/Applications` (admin group), so a `sudo` line can work.
    pub admin: bool,
}

/// Single-quote for a copyable shell line (no `!` history expansion, `$` or backtick surprises).
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

const MAC_BIN: &str = "/usr/local/bin";
const MAC_LINK: &str = "/usr/local/bin/garita";
/// The profile line that puts `~/.local/bin` on PATH (zsh and bash).
const LOCAL_BIN_PATH_LINE: &str = r#"export PATH="$HOME/.local/bin:$PATH""#;

pub fn decide_status(p: &Probe) -> CliStatus {
    let n = CLI_COMMAND_NAME;
    let resolved_path = p.found.clone();
    match p.os {
        Os::Mac => {
            let on_path = p.found_target.as_deref() == Some(p.exe.as_str());
            let exe = sh_quote(&p.exe);
            // An administrator can `sudo` into /usr/local/bin, which is on PATH by default. A
            // standard account cannot: it gets a per-user link and, unless that folder is
            // already on PATH, the profile line to add.
            let (manual, path_hint) = if p.admin {
                let ln = if p.link_is_symlink { "ln -sfh" } else { "ln -s" };
                let mkdir = if p.local_bin_exists { String::new() } else { format!("sudo mkdir -p {MAC_BIN} && ") };
                (format!("{mkdir}sudo {ln} {exe} {MAC_LINK}"), None)
            } else {
                let local_bin_on_path = p.user_bin.as_deref().is_some_and(|d| d.ends_with("/.local/bin"));
                (
                    format!("mkdir -p ~/.local/bin && ln -s {exe} ~/.local/bin/{n}"),
                    (!local_bin_on_path).then(|| LOCAL_BIN_PATH_LINE.to_string()),
                )
            };
            CliStatus {
                method: "symlink".into(),
                on_path,
                resolved_path,
                manual_command: Some(manual),
                path_hint,
            }
        }
        Os::Linux => match &p.appimage {
            None => CliStatus {
                method: "package".into(),
                on_path: p.found_target.as_deref() == Some(p.exe.as_str()),
                resolved_path,
                manual_command: None,
                path_hint: None,
            },
            Some(img) => CliStatus {
                method: "manual".into(),
                on_path: p.found_target.as_deref() == Some(img.as_str()),
                resolved_path,
                manual_command: Some(format!("ln -s {} ~/.local/bin/{n}", sh_quote(img))),
                path_hint: None,
            },
        },
        Os::Windows => {
            let on_path = p.found.is_some();
            CliStatus {
                method: "installer".into(),
                on_path,
                resolved_path,
                manual_command: if on_path { None } else { Some(parent_dir(&p.exe)) },
                path_hint: None,
            }
        }
    }
}

/// The first per-user bin folder that exists and is on PATH: `$HOME/.local/bin`, then
/// `$HOME/bin`. Never creates one: a new folder would not be on PATH.
#[cfg_attr(windows, allow(dead_code))] // macOS probe only; tested everywhere
pub fn user_bin(home: &str, path: &[String], is_dir: &dyn Fn(&str) -> bool) -> Option<String> {
    let home = home.trim_end_matches('/');
    if home.is_empty() {
        return None;
    }
    [".local/bin", "bin"]
        .iter()
        .map(|d| format!("{home}/{d}"))
        .find(|c| is_dir(c) && path.iter().any(|e| e.trim_end_matches('/') == c.as_str()))
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

/// Where install tries to link, in order: `/usr/local/bin` (on PATH by default; an older link
/// there would shadow a newer one elsewhere), then the per-user folder from `user_bin`.
#[cfg(any(target_os = "macos", test))]
pub fn install_links(user_bin: Option<&str>) -> Vec<String> {
    std::iter::once(MAC_BIN)
        .chain(user_bin)
        .map(|d| format!("{d}/{CLI_COMMAND_NAME}"))
        .collect()
}

#[cfg(any(target_os = "macos", test))]
pub fn plan_install(exe: &str, read_only: bool, entry: &EntryState, link: &str) -> Result<InstallPlan, String> {
    if read_only || exe.contains("/AppTranslocation/") {
        return Err("Failed to install command: Garita is running from a temporary location. \
Move Garita to an Applications folder (/Applications or ~/Applications), reopen it, and try again."
            .into());
    }
    let foreign = || {
        Err(format!(
            "Failed to install command: {link} already exists and is not Garita's link"
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
            user_bin: None,
            admin: false,
        })
    }

    #[cfg(not(windows))]
    {
        let mut dirs: Vec<std::path::PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        let mac = cfg!(target_os = "macos");
        let path_dirs: Vec<String> = dirs.iter().map(|d| d.to_string_lossy().into_owned()).collect();
        let home = std::env::var("HOME").unwrap_or_default();
        let user_bin = if mac {
            user_bin(&home, &path_dirs, &|d: &str| std::path::Path::new(d).is_dir())
        } else {
            None
        };
        if mac {
            dirs.push(MAC_BIN.into());
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
            local_bin_exists: std::path::Path::new(MAC_BIN).is_dir(),
            link_is_symlink: std::fs::symlink_metadata(link)
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false),
            user_bin,
            admin: mac_admin(),
        })
    }
}

/// `/Applications` is `root:admin` mode 775 on stock macOS, so write access means the admin
/// group, whose members can `sudo`.
#[cfg(target_os = "macos")]
fn mac_admin() -> bool {
    let Ok(c) = std::ffi::CString::new("/Applications") else { return false };
    // SAFETY: `c` is NUL-terminated and outlives the call; `access` only reads it.
    unsafe { libc::access(c.as_ptr(), libc::W_OK) == 0 }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn mac_admin() -> bool {
    false
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
fn entry_state(link: &str) -> EntryState {
    let link = std::path::Path::new(link);
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

/// macOS only: symlink `garita` to this app's binary in the first writable folder of
/// `install_links`. No privilege escalation.
#[tauri::command]
pub async fn install_cli_command() -> Result<CliStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let probe = current_probe()?;
        let read_only = volume_read_only(&probe.exe);
        for link in install_links(probe.user_bin.as_deref()) {
            let plan = plan_install(&probe.exe, read_only, &entry_state(&link), &link)?;
            let path = std::path::Path::new(&link);
            let made = match plan {
                InstallPlan::Replace => std::fs::remove_file(path),
                InstallPlan::Create => Ok(()),
            }
            .and_then(|()| std::os::unix::fs::symlink(&probe.exe, path));
            match made {
                Ok(()) => return current_probe().map(|p| decide_status(&p)),
                Err(e) if denied(&e) => continue,
                Err(e) => return Err(format!("Failed to install command: {}", e)),
            }
        }
        // Nowhere writable: hand back the manual command.
        Ok(decide_status(&probe))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Failed to install command: not supported on this platform".into())
    }
}

/// Permission denied / missing directory is not a failure: try the next folder.
#[cfg(target_os = "macos")]
fn denied(e: &std::io::Error) -> bool {
    use std::io::ErrorKind::{NotFound, PermissionDenied};
    matches!(e.kind(), PermissionDenied | NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "/Applications/Garita.app/Contents/MacOS/garita";

    /// An administrator's probe (the `sudo` rows); `standard` below flips it.
    fn mac(found: Option<&str>, target: Option<&str>, bin: bool, sym: bool) -> Probe {
        Probe {
            os: Os::Mac,
            exe: EXE.into(),
            appimage: None,
            found: found.map(Into::into),
            found_target: target.map(Into::into),
            local_bin_exists: bin,
            link_is_symlink: sym,
            user_bin: None,
            admin: true,
        }
    }

    fn standard(user_bin: Option<&str>) -> Probe {
        Probe { user_bin: user_bin.map(Into::into), admin: false, ..mac(None, None, false, false) }
    }

    #[test]
    fn mac_admin_line_has_no_path_hint() {
        assert!(decide_status(&mac(None, None, true, false)).path_hint.is_none());
    }

    #[test]
    fn mac_standard_account_gets_a_per_user_line_without_sudo() {
        let s = decide_status(&standard(None));
        assert_eq!(
            s.manual_command.as_deref(),
            Some("mkdir -p ~/.local/bin && ln -s '/Applications/Garita.app/Contents/MacOS/garita' ~/.local/bin/garita")
        );
        assert_eq!(s.path_hint.as_deref(), Some(r#"export PATH="$HOME/.local/bin:$PATH""#));
        // ~/.local/bin already on PATH: no profile line
        assert!(decide_status(&standard(Some("/Users/u/.local/bin"))).path_hint.is_none());
        // only ~/bin on PATH: the line still puts ~/.local/bin there
        assert!(decide_status(&standard(Some("/Users/u/bin"))).path_hint.is_some());
        // the app path is quoted in the per-user line too
        let p = Probe { exe: "/Users/u/Applications/it's/Garita.app/Contents/MacOS/garita".into(), ..standard(None) };
        assert!(decide_status(&p).manual_command.unwrap().contains(r"'/Users/u/Applications/it'\''s/Garita.app/Contents/MacOS/garita'"));
    }

    #[test]
    fn user_bin_picks_an_existing_folder_on_path() {
        let path = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let all = |_: &str| true;
        let none = |_: &str| false;
        let home = "/Users/u";
        assert_eq!(user_bin(home, &path(&["/usr/bin", "/Users/u/.local/bin"]), &all).as_deref(), Some("/Users/u/.local/bin"));
        // ~/.local/bin wins over ~/bin; a trailing slash on PATH still matches
        assert_eq!(user_bin(home, &path(&["/Users/u/bin/", "/Users/u/.local/bin/"]), &all).as_deref(), Some("/Users/u/.local/bin"));
        assert_eq!(user_bin("/Users/u/", &path(&["/Users/u/bin"]), &all).as_deref(), Some("/Users/u/bin"));
        // on PATH but missing: not used (install never creates a folder)
        assert_eq!(user_bin(home, &path(&["/Users/u/.local/bin"]), &none), None);
        let only_bin = |d: &str| d == "/Users/u/bin";
        assert_eq!(user_bin(home, &path(&["/Users/u/.local/bin", "/Users/u/bin"]), &only_bin).as_deref(), Some("/Users/u/bin"));
        // exists but not on PATH, a literal `~`, or no HOME
        assert_eq!(user_bin(home, &path(&["/usr/bin"]), &all), None);
        assert_eq!(user_bin(home, &path(&["~/.local/bin"]), &all), None);
        assert_eq!(user_bin("", &path(&["/.local/bin", "/bin"]), &all), None);
    }

    #[test]
    fn install_links_try_usr_local_first() {
        assert_eq!(install_links(None), ["/usr/local/bin/garita"]);
        assert_eq!(install_links(Some("/Users/u/.local/bin")), ["/usr/local/bin/garita", "/Users/u/.local/bin/garita"]);
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
            user_bin: None,
            admin: false,
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
            user_bin: None,
            admin: false,
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
        let l = MAC_LINK;
        let live = |t: &str| EntryState::Symlink { target: t.into(), live: true };
        assert_eq!(plan_install(EXE, false, &EntryState::Absent, l), Ok(InstallPlan::Create));
        assert_eq!(plan_install(EXE, false, &live(EXE), l), Ok(InstallPlan::Replace));
        // dangling, any target: replaced
        let dang = EntryState::Symlink { target: "/gone".into(), live: false };
        assert_eq!(plan_install(EXE, false, &dang, l), Ok(InstallPlan::Replace));
        // live link elsewhere, and a regular file: foreign
        for e in [live("/usr/bin/other"), EntryState::Other] {
            let err = plan_install(EXE, false, &e, l).unwrap_err();
            assert_eq!(
                err,
                "Failed to install command: /usr/local/bin/garita already exists and is not Garita's link"
            );
        }
        // the per-user link names its own path
        let err = plan_install(EXE, false, &EntryState::Other, "/Users/u/.local/bin/garita").unwrap_err();
        assert_eq!(err, "Failed to install command: /Users/u/.local/bin/garita already exists and is not Garita's link");
        // K12
        let t = "/private/var/folders/x/AppTranslocation/ABC/d/Garita.app/Contents/MacOS/garita";
        let err = plan_install(t, false, &EntryState::Absent, l).unwrap_err();
        assert!(err.contains("temporary location") && err.contains("/Applications or ~/Applications"));
        assert!(plan_install(EXE, true, &EntryState::Absent, l).unwrap_err().contains("temporary location"));
    }
}
