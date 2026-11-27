use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;
use std::io;
use std::time::Duration;

use super::dashboard::Dashboard;
use crate::config::Config;
use crate::session::store::StateStore;

pub async fn run(db: StateStore, cfg: Config) -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut dashboard = Dashboard::new(db, cfg);

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
                        (_, KeyCode::Enter) => dashboard.submit_input().await,
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

                match (key.modifiers, key.code) {
                    (KeyModifiers::CONTROL, KeyCode::Char('c')) => break,
                    (KeyModifiers::CONTROL, KeyCode::Char('w')) => {
                        dashboard.begin_pane_command_mode()
                    }
                    (_, KeyCode::Char('q')) => break,
                    _ if dashboard.handle_pane_navigation_key(key) => {}
                    (_, KeyCode::Tab) => dashboard.next_pane(),
                    (KeyModifiers::SHIFT, KeyCode::BackTab) => dashboard.prev_pane(),
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
                    (_, KeyCode::Char('n')) => dashboard.new_session().await,
                    (_, KeyCode::Char('a')) => dashboard.assign_selected().await,
                    (_, KeyCode::Char('b')) => dashboard.rebalance_selected_team().await,
                    (_, KeyCode::Char('B')) => dashboard.rebalance_all_teams().await,
                    (_, KeyCode::Char('i')) => dashboard.drain_inbox_selected().await,
                    (_, KeyCode::Char('I')) => dashboard.focus_next_approval_target(),
                    (_, KeyCode::Char('g')) => dashboard.auto_dispatch_backlog().await,
                    (_, KeyCode::Char('G')) => dashboard.coordinate_backlog().await,
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
                    (_, KeyCode::Char('m')) => dashboard.merge_selected_worktree().await,
                    (_, KeyCode::Char('M')) => dashboard.merge_ready_worktrees().await,
                    (_, KeyCode::Char('l')) => dashboard.cycle_pane_layout(),
                    (_, KeyCode::Char('T')) => dashboard.toggle_theme(),
                    (_, KeyCode::Char('p')) => dashboard.toggle_auto_dispatch_policy(),
                    (_, KeyCode::Char('t')) => dashboard.toggle_auto_worktree_policy(),
                    (_, KeyCode::Char('w')) => dashboard.toggle_auto_merge_policy(),
                    (_, KeyCode::Char(',')) => dashboard.adjust_auto_dispatch_limit(-1),
                    (_, KeyCode::Char('.')) => dashboard.adjust_auto_dispatch_limit(1),
                    (_, KeyCode::Char('s')) => dashboard.stop_selected().await,
                    (_, KeyCode::Char('u')) => dashboard.resume_selected().await,
                    (_, KeyCode::Char('x')) => dashboard.cleanup_selected_worktree().await,
                    (_, KeyCode::Char('X')) => dashboard.prune_inactive_worktrees().await,
                    (_, KeyCode::Char('d')) => dashboard.delete_selected_session().await,
                    (_, KeyCode::Char('r')) => dashboard.refresh(),
                    (_, KeyCode::Char('?')) => dashboard.toggle_help(),
                    _ => {}
                }
            }
        }

        dashboard.tick().await;
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
