use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::mpsc::{self, Sender};
use std::time::Duration;

use super::dashboard::{
    run_assign, run_auto_dispatch, run_cleanup, run_coordinate, run_delete, run_drain_inbox,
    run_merge, run_merge_ready, run_new_session, run_prune, run_rebalance_all,
    run_rebalance_selected, run_resume, run_stop, Dashboard, OpApply, PendingConfirm,
};
use crate::config::Config;
use crate::session::store::StateStore;

/// A background operation body: given its own `StateStore` connection, produces
/// the [`OpApply`] to hand back to the event loop. Boxed because each operation
/// captures different owned inputs and borrows the store across `await`.
type OpBody = Box<dyn FnOnce(StateStore) -> Pin<Box<dyn Future<Output = OpApply>>> + Send + 'static>;

/// Restore the terminal to its normal state. Safe to call more than once.
fn restore_terminal() {
    let _ = disable_raw_mode();
    let _ = execute!(io::stdout(), LeaveAlternateScreen);
}

/// Runs a long operation off the event-loop thread.
///
/// The operation gets its own dedicated OS thread with a private current-thread
/// Tokio runtime and its own `StateStore` connection (the state database is
/// explicitly designed for concurrent connections — WAL plus a generous
/// `busy_timeout`). The resulting [`OpApply`] is sent back over `op_tx`, which
/// the event loop drains each tick and applies on the loop thread. This keeps
/// the UI drawing and polling — and showing the in-progress note — while git,
/// merge, and dispatch work runs in the background.
fn launch_op(cfg: &Config, op_tx: &Sender<OpApply>, body: OpBody) {
    let db_path = cfg.db_path.clone();
    let op_tx = op_tx.clone();
    std::thread::Builder::new()
        .name("ecc-long-op".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    let _ = op_tx.send(OpApply::failure(format!(
                        "operation runtime unavailable: {error}"
                    )));
                    return;
                }
            };
            let apply = runtime.block_on(async move {
                let store = match StateStore::open(&db_path) {
                    Ok(store) => store,
                    Err(error) => {
                        return OpApply::failure(format!(
                            "operation state store unavailable: {error}"
                        ));
                    }
                };
                body(store).await
            });
            let _ = op_tx.send(apply);
        })
        .expect("failed to spawn long-op worker thread");
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

    let mut dashboard = Dashboard::new(db, cfg.clone());

    // Channel that background operation threads use to hand their result back to
    // the event loop. Only one operation runs at a time (`op_in_flight`).
    let (op_tx, op_rx) = mpsc::channel::<OpApply>();
    let mut op_in_flight = false;

    // Spawns a long operation off the event loop. `$note` is drawn immediately
    // as the in-progress note; `$body` is the owned, `'static` closure that runs
    // on the worker thread with its own `StateStore`.
    macro_rules! spawn_op {
        ($note:expr, $body:expr) => {{
            dashboard.begin_blocking_note($note);
            launch_op(&cfg, &op_tx, Box::new($body));
            op_in_flight = true;
        }};
    }

    // Submit prompts (commit / PR / spawn / search) remain awaited inline with an
    // in-progress note: they interleave reads of live dashboard state (selection,
    // diff summary, input buffers) between the git work and the state update, so
    // moving them to a background thread would risk a correctness regression.
    macro_rules! inline_long_op {
        ($note:expr, $method:ident) => {{
            dashboard.begin_blocking_note($note);
            terminal.draw(|frame| dashboard.render(frame))?;
            dashboard.$method().await;
        }};
    }

    loop {
        // Apply any finished background operation before drawing so the new state
        // is visible on this frame.
        if let Ok(apply) = op_rx.try_recv() {
            dashboard.apply_op(apply);
            op_in_flight = false;
        }

        terminal.draw(|frame| dashboard.render(frame))?;

        if event::poll(Duration::from_millis(250))? {
            if let Event::Key(key) = event::read()? {
                // While a long operation runs, ignore action keys so a second
                // mutating git/dispatch op can never start concurrently. Quit
                // and read-only scrolling stay responsive; the in-progress note
                // is preserved.
                if op_in_flight {
                    match (key.modifiers, key.code) {
                        (KeyModifiers::CONTROL, KeyCode::Char('c')) => break,
                        (_, KeyCode::Char('j')) | (_, KeyCode::Down) => dashboard.scroll_down(),
                        (_, KeyCode::Char('k')) | (_, KeyCode::Up) => dashboard.scroll_up(),
                        _ => {}
                    }

                    continue;
                }

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
                            inline_long_op!("submitting…", submit_input)
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
                                    if let Some(id) = dashboard.begin_selected_session_id() {
                                        spawn_op!("deleting session…", move |store| Box::pin(
                                            async move { run_delete(&store, id).await }
                                        ));
                                    }
                                }
                                PendingConfirm::PruneWorktrees => {
                                    let cfg = cfg.clone();
                                    spawn_op!("pruning inactive worktrees…", move |store| Box::pin(
                                        async move { run_prune(&store, cfg).await }
                                    ));
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
                    (_, KeyCode::Char('n')) => {
                        if let Some(inputs) = dashboard.begin_new_session() {
                            let cfg = cfg.clone();
                            spawn_op!("creating session…", move |store| Box::pin(async move {
                                run_new_session(&store, cfg, inputs).await
                            }));
                        }
                    }
                    (_, KeyCode::Char('a')) => {
                        if let Some((source_id, task)) = dashboard.begin_assign() {
                            let cfg = cfg.clone();
                            spawn_op!("assigning follow-up…", move |store| Box::pin(async move {
                                run_assign(&store, cfg, source_id, task).await
                            }));
                        }
                    }
                    (_, KeyCode::Char('b')) => {
                        if let Some(source_id) = dashboard.begin_rebalance_selected() {
                            let cfg = cfg.clone();
                            spawn_op!("rebalancing team…", move |store| Box::pin(async move {
                                run_rebalance_selected(&store, cfg, source_id).await
                            }));
                        }
                    }
                    (_, KeyCode::Char('B')) => {
                        let (lead_limit, selected_id) = dashboard.begin_global_backlog();
                        let cfg = cfg.clone();
                        spawn_op!("rebalancing all teams…", move |store| Box::pin(async move {
                            run_rebalance_all(&store, cfg, lead_limit, selected_id).await
                        }));
                    }
                    (_, KeyCode::Char('i')) => {
                        if let Some(source_id) = dashboard.begin_drain_inbox() {
                            let cfg = cfg.clone();
                            spawn_op!("draining inbox…", move |store| Box::pin(async move {
                                run_drain_inbox(&store, cfg, source_id).await
                            }));
                        }
                    }
                    (_, KeyCode::Char('I')) => dashboard.focus_next_approval_target(),
                    (_, KeyCode::Char('g')) => {
                        let (lead_limit, selected_id) = dashboard.begin_global_backlog();
                        let cfg = cfg.clone();
                        spawn_op!("dispatching backlog…", move |store| Box::pin(async move {
                            run_auto_dispatch(&store, cfg, lead_limit, selected_id).await
                        }));
                    }
                    (_, KeyCode::Char('G')) => {
                        let (lead_limit, selected_id) = dashboard.begin_global_backlog();
                        let cfg = cfg.clone();
                        spawn_op!("coordinating backlog…", move |store| Box::pin(async move {
                            run_coordinate(&store, cfg, lead_limit, selected_id).await
                        }));
                    }
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
                    (_, KeyCode::Char('m')) => {
                        if let Some(session_id) = dashboard.begin_merge() {
                            spawn_op!("merging worktree…", move |store| Box::pin(async move {
                                run_merge(&store, session_id).await
                            }));
                        }
                    }
                    (_, KeyCode::Char('M')) => {
                        spawn_op!("merging ready worktrees…", move |store| Box::pin(
                            async move { run_merge_ready(&store).await }
                        ));
                    }
                    (_, KeyCode::Char('l')) => dashboard.cycle_pane_layout(),
                    (_, KeyCode::Char('T')) => dashboard.toggle_theme(),
                    (_, KeyCode::Char('p')) => dashboard.toggle_auto_dispatch_policy(),
                    (_, KeyCode::Char('t')) => dashboard.toggle_auto_worktree_policy(),
                    (_, KeyCode::Char('w')) => dashboard.toggle_auto_merge_policy(),
                    (_, KeyCode::Char(',')) => dashboard.adjust_auto_dispatch_limit(-1),
                    (_, KeyCode::Char('.')) => dashboard.adjust_auto_dispatch_limit(1),
                    (_, KeyCode::Char('s')) => {
                        if let Some(session_id) = dashboard.begin_selected_session_id() {
                            spawn_op!("stopping session…", move |store| Box::pin(async move {
                                run_stop(&store, session_id).await
                            }));
                        }
                    }
                    (_, KeyCode::Char('u')) => {
                        if let Some(session_id) = dashboard.begin_selected_session_id() {
                            let cfg = cfg.clone();
                            spawn_op!("resuming session…", move |store| Box::pin(async move {
                                run_resume(&store, cfg, session_id).await
                            }));
                        }
                    }
                    (_, KeyCode::Char('x')) => {
                        if let Some(session_id) = dashboard.begin_cleanup() {
                            spawn_op!("cleaning worktree…", move |store| Box::pin(async move {
                                run_cleanup(&store, session_id).await
                            }));
                        }
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

        // Skip the periodic tick while a long operation is running: the
        // background worker owns state mutation for its duration, matching the
        // original inline-await ordering where tick could not run mid-op.
        if !op_in_flight {
            dashboard.tick().await;
        }
    }

    restore_terminal();
    Ok(())
}
