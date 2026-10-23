//! Launcher: pull delivery of launch args (K6). App-local, no `context`.

use crate::launch::{os_argv, parse_launch_args, LaunchAction, LaunchArgs};
use std::sync::Mutex;

#[derive(Default)]
struct Slots {
    /// Latest forwarded second-instance args, not yet pulled.
    pending: Option<LaunchArgs>,
    /// The first instance's own argv was handed out (or superseded).
    own_taken: bool,
}

static SLOTS: Mutex<Slots> = Mutex::new(Slots { pending: None, own_taken: false });

/// Pending beats own argv; own argv is returned once; then only the default.
fn take(s: &mut Slots, own: impl FnOnce() -> LaunchArgs) -> LaunchArgs {
    if let Some(p) = s.pending.take() {
        s.own_taken = true;
        return p;
    }
    if s.own_taken {
        return LaunchArgs::default();
    }
    s.own_taken = true;
    own()
}

/// Called by the single-instance callback; latest wins.
pub fn set_pending(args: LaunchArgs) {
    SLOTS.lock().unwrap_or_else(|e| e.into_inner()).pending = Some(args);
}

#[tauri::command]
pub async fn get_launch_args() -> Result<LaunchArgs, String> {
    let mut s = SLOTS.lock().unwrap_or_else(|e| e.into_inner());
    Ok(take(&mut s, || match parse_launch_args(&os_argv()) {
        LaunchAction::Run(a) => a,
        _ => LaunchArgs::default(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(c: &str) -> LaunchArgs {
        LaunchArgs { context: Some(c.into()), ..Default::default() }
    }

    #[test]
    fn own_once_then_default() {
        let mut s = Slots::default();
        assert_eq!(take(&mut s, || a("own")), a("own"));
        assert_eq!(take(&mut s, || a("own")), LaunchArgs::default());
    }

    #[test]
    fn pending_beats_own_and_consumes_it() {
        let mut s = Slots { pending: Some(a("p")), own_taken: false };
        assert_eq!(take(&mut s, || a("own")), a("p"));
        assert_eq!(take(&mut s, || a("own")), LaunchArgs::default());
    }

    #[test]
    fn pending_after_own_and_latest_wins() {
        let mut s = Slots::default();
        take(&mut s, || a("own"));
        s.pending = Some(a("1"));
        s.pending = Some(a("2"));
        assert_eq!(take(&mut s, LaunchArgs::default), a("2"));
        assert_eq!(take(&mut s, LaunchArgs::default), LaunchArgs::default());
    }
}
