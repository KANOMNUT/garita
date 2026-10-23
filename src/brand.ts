// The product name, the single source for user-visible strings. Flips at the rename (RB-1b).
// Mirrors `PRODUCT_NAME` in src-tauri/src/commands/utils.rs.
export const PRODUCT_NAME = "Garita";

// Final copy: docs/ux/10-rebrand.md Part 1 (RB-6). Must not name the old product.
export const UPGRADE_NOTICE_TITLE = "All clusters start read-only";
export const UPGRADE_NOTICE_BODY =
  "Settings from your earlier install couldn't be carried over, so every cluster starts read-only. Colours, labels, typed confirmation, bulk limits, the active cluster and view preferences were reset. Turn read-only off per cluster from the Read-only chip in the top bar.";

// The command-line launcher name. Mirrors `CLI_COMMAND_NAME` in src-tauri/src/launch.rs.
export const CLI_COMMAND_NAME = "garita";
