use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;
use std::io;
use std::time::Duration;

use super::dashboard::{Dashboard, PendingConfirm};
use crate::config::Config;
use crate::session::store::StateStore;

/// Restore the terminal to its normal state. Safe to call more than once.
fn restore_terminal() {
    let _ = disable_raw_mode();
    let _ = execute!(io::stdout(), LeaveAlternateScreen);
}

pub async fn run(db: StateStore, cfg: Config) -> Result<()> {
    // Install a panic hook that restores the terminal before the default hook
    // prints the panic, so a panic mid-session does not leave the terminal in
    // raw mode / the alternate screen. Chains the previous hook.
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        restore_terminal();
        previous_hook(info);
    }));

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut dashboard = Dashboard::new(db, cfg);

    // Set an in-progress status note and draw one frame before awaiting a
    // long-running async action, so the operator gets immediate feedback
    // instead of a frozen UI while git/merge/dispatch work runs.
    macro_rules! long_op {
        ($note:expr, $method:ident) => {{
            dashboard.begin_blocking_note($note);
            terminal.draw(|frame| dashboard.render(frame))?;
            dashboard.$method().await;
        }};
    }

    loop {
        terminal.draw(|frame| dashboard.render(frame))?;

        if event::poll(Duration::from_millis(250))? {
            if let Event::Key(key) = event::read()? {
                if dashboard.has_active_completion_popup() {
                    match (key.modifiers, key.code) {
                        (KeyModifiers::CONTROL, KeyCode::Char('c')) => break,
                        (_, KeyCode::Esc) | (_, KeyCode::Enter) | (_, KeyCode::Char(' ')) => {
                            dashboard.dismiss_completion_popup();
                        }
                        _ => {}
                    }

                    continue;
                }

                if dashboard.is_input_mode() {
                    match (key.modifiers, key.code) {
                        (KeyModifiers::CONTROL, KeyCode::Char('c')) => break,
                        (_, KeyCode::Esc) => dashboard.cancel_input(),
                        (_, KeyCode::Enter) => {
                            dashboard.begin_blocking_note("submitting…");
                            terminal.draw(|frame| dashboard.render(frame))?;
                            dashboard.submit_input().await;
                        }
                        (_, KeyCode::Backspace) => dashboard.pop_input_char(),
                        (modifiers, KeyCode::Char(ch))
                            if !modifiers.contains(KeyModifiers::CONTROL)
                                && !modifiers.contains(KeyModifiers::ALT) =>
                        {
                            dashboard.push_input_char(ch);
                        }
                        _ => {}
                    }

                    continue;
                }

                if dashboard.is_pane_command_mode() {
                    if dashboard.handle_pane_command_key(key) {
                        continue;
                    }
                }

                // Help is modal: while it is shown, only scroll and close keys
                // are honored, so bare letters never trigger actions behind it.
                if dashboard.is_help_visible() {
                    match (key.modifiers, key.code) {
                        (KeyModifiers::CONTROL, KeyCode::Char('c')) => break,
                        (_, KeyCode::Esc)
                        | (_, KeyCode::Char('q'))
                        | (_, KeyCode::Char('?')) => dashboard.toggle_help(),
                        (_, KeyCode::Char('j')) | (_, KeyCode::Down) => {
                            dashboard.scroll_help_down()
                        }
                        (_, KeyCode::Char('k')) | (_, KeyCode::Up) => dashboard.scroll_help_up(),
                        _ => {}
                    }

                    continue;
                }

                // Confirmation prompt for destructive single-key actions.
                if let Some(pending) = dashboard.pending_confirm() {
                    match (key.modifiers, key.code) {
                        (KeyModifiers::CONTROL, KeyCode::Char('c')) => break,
                        (m, KeyCode::Char('y'))
                            if !m.contains(KeyModifiers::CONTROL)
                                && !m.contains(KeyModifiers::ALT) =>
                        {
                            dashboard.clear_pending_confirm();
                            match pending {
                                PendingConfirm::DeleteSession => {
                                    long_op!("deleting session…", delete_selected_session)
                                }
                                PendingConfirm::PruneWorktrees => {
                                    long_op!("pruning inactive worktrees…", prune_inactive_worktrees)
                                }
                            }
                        }
                        _ => dashboard.cancel_pending_confirm(),
                    }

                    continue;
                }

                // Mirror the input-mode handler: bare-letter actions must only
                // fire when no CONTROL/ALT modifier is held (NONE or SHIFT only),
                // so combos like Ctrl+D/Alt+x can never trigger destructive keys.
                let has_ctrl_alt = key.modifiers.contains(KeyModifiers::CONTROL)
                    || key.modifiers.contains(KeyModifiers::ALT);

                match (key.modifiers, key.code) {
                    (KeyModifiers::CONTROL, KeyCode::Char('c')) => break,
                    (KeyModifiers::CONTROL, KeyCode::Char('w')) => {
                        dashboard.begin_pane_command_mode()
                    }
                    // Accept BackTab with SHIFT or bare (some terminals emit it
                    // without SHIFT) but never with CONTROL/ALT.
                    (_, KeyCode::BackTab) if !has_ctrl_alt => dashboard.prev_pane(),
                    // Configured pane-navigation keys keep working with whatever
                    // modifiers the config binds them to.
                    _ if dashboard.handle_pane_navigation_key(key) => {}
                    // Swallow any other CONTROL/ALT combo so the bare-letter arms
                    // below only ever see NONE/SHIFT modifiers.
                    _ if has_ctrl_alt => {}
                    (_, KeyCode::Char('q')) => break,
                    (_, KeyCode::Tab) => dashboard.next_pane(),
                    (_, KeyCode::Char('+')) | (_, KeyCode::Char('=')) => {
                        dashboard.increase_pane_size()
                    }
                    (_, KeyCode::Char('-')) => dashboard.decrease_pane_size(),
                    (_, KeyCode::Char('j')) | (_, KeyCode::Down) => dashboard.scroll_down(),
                    (_, KeyCode::Char('k')) | (_, KeyCode::Up) => dashboard.scroll_up(),
                    (_, KeyCode::Char('[')) => dashboard.focus_previous_delegate(),
                    (_, KeyCode::Char(']')) => dashboard.focus_next_delegate(),
                    (_, KeyCode::Enter) => dashboard.open_focused_delegate(),
                    (_, KeyCode::Char('/')) => dashboard.begin_search(),
                    (_, KeyCode::Esc) => dashboard.clear_search(),
                    (_, KeyCode::Char('n')) if dashboard.has_active_search() => {
                        dashboard.next_search_match()
                    }
                    (_, KeyCode::Char('N')) if dashboard.has_active_search() => {
                        dashboard.prev_search_match()
                    }
                    (_, KeyCode::Char('N')) => dashboard.begin_spawn_prompt(),
                    (_, KeyCode::Char('n')) => long_op!("creating session…", new_session),
                    (_, KeyCode::Char('a')) => long_op!("assigning follow-up…", assign_selected),
                    (_, KeyCode::Char('b')) => {
                        long_op!("rebalancing team…", rebalance_selected_team)
                    }
                    (_, KeyCode::Char('B')) => {
                        long_op!("rebalancing all teams…", rebalance_all_teams)
                    }
                    (_, KeyCode::Char('i')) => long_op!("draining inbox…", drain_inbox_selected),
                    (_, KeyCode::Char('I')) => dashboard.focus_next_approval_target(),
                    (_, KeyCode::Char('g')) => {
                        long_op!("dispatching backlog…", auto_dispatch_backlog)
                    }
                    (_, KeyCode::Char('G')) => long_op!("coordinating backlog…", coordinate_backlog),
                    (_, KeyCode::Char('K')) => dashboard.toggle_context_graph_mode(),
                    (_, KeyCode::Char('h')) => dashboard.collapse_selected_pane(),
                    (_, KeyCode::Char('H')) => dashboard.restore_collapsed_panes(),
                    (_, KeyCode::Char('y')) => dashboard.toggle_timeline_mode(),
                    (_, KeyCode::Char('E')) if dashboard.is_context_graph_mode() => {
                        dashboard.cycle_graph_entity_filter()
                    }
                    (_, KeyCode::Char('E')) => dashboard.cycle_timeline_event_filter(),
                    (_, KeyCode::Char('v')) => dashboard.toggle_output_mode(),
                    (_, KeyCode::Char('z')) => dashboard.toggle_git_status_mode(),
                    (_, KeyCode::Char('V')) => dashboard.toggle_diff_view_mode(),
                    (_, KeyCode::Char('S')) => dashboard.stage_selected_git_status(),
                    (_, KeyCode::Char('U')) => dashboard.unstage_selected_git_status(),
                    (_, KeyCode::Char('R')) => dashboard.reset_selected_git_status(),
                    (_, KeyCode::Char('C')) => dashboard.begin_commit_prompt(),
                    (_, KeyCode::Char('P')) => dashboard.begin_pr_prompt(),
                    (_, KeyCode::Char('{')) => dashboard.prev_diff_hunk(),
                    (_, KeyCode::Char('}')) => dashboard.next_diff_hunk(),
                    (_, KeyCode::Char('c')) => dashboard.toggle_conflict_protocol_mode(),
                    (_, KeyCode::Char('e')) => dashboard.toggle_output_filter(),
                    (_, KeyCode::Char('f')) => dashboard.cycle_output_time_filter(),
                    (_, KeyCode::Char('A')) => dashboard.toggle_search_scope(),
                    (_, KeyCode::Char('o')) => dashboard.toggle_search_agent_filter(),
                    (_, KeyCode::Char('m')) => long_op!("merging worktree…", merge_selected_worktree),
                    (_, KeyCode::Char('M')) => {
                        long_op!("merging ready worktrees…", merge_ready_worktrees)
                    }
                    (_, KeyCode::Char('l')) => dashboard.cycle_pane_layout(),
                    (_, KeyCode::Char('T')) => dashboard.toggle_theme(),
                    (_, KeyCode::Char('p')) => dashboard.toggle_auto_dispatch_policy(),
                    (_, KeyCode::Char('t')) => dashboard.toggle_auto_worktree_policy(),
                    (_, KeyCode::Char('w')) => dashboard.toggle_auto_merge_policy(),
                    (_, KeyCode::Char(',')) => dashboard.adjust_auto_dispatch_limit(-1),
                    (_, KeyCode::Char('.')) => dashboard.adjust_auto_dispatch_limit(1),
                    (_, KeyCode::Char('s')) => long_op!("stopping session…", stop_selected),
                    (_, KeyCode::Char('u')) => long_op!("resuming session…", resume_selected),
                    (_, KeyCode::Char('x')) => {
                        long_op!("cleaning worktree…", cleanup_selected_worktree)
                    }
                    // Destructive: require explicit y/n confirmation.
                    (_, KeyCode::Char('X')) => dashboard.request_prune_confirm(),
                    (_, KeyCode::Char('d')) => dashboard.request_delete_confirm(),
                    (_, KeyCode::Char('r')) => dashboard.refresh(),
                    (_, KeyCode::Char('?')) => dashboard.toggle_help(),
                    _ => {}
                }
            }
        }

        dashboard.tick().await;
    }

    restore_terminal();
    Ok(())
}
