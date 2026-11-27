use crate::config::BudgetAlertThresholds;

use ratatui::{
    prelude::*,
    text::{Line, Span},
    widgets::{Gauge, Paragraph, Widget},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum BudgetState {
    Unconfigured,
    Normal,
    Alert50,
    Alert75,
    Alert90,
    OverBudget,
}

impl BudgetState {
    fn badge(self, thresholds: BudgetAlertThresholds) -> Option<String> {
        match self {
            Self::Alert50 => Some(threshold_label(thresholds.advisory)),
            Self::Alert75 => Some(threshold_label(thresholds.warning)),
            Self::Alert90 => Some(threshold_label(thresholds.critical)),
            Self::OverBudget => Some("over budget".to_string()),
            Self::Unconfigured => Some("no budget".to_string()),
            Self::Normal => None,
        }
    }

    pub(crate) fn summary_suffix(self, thresholds: BudgetAlertThresholds) -> Option<String> {
        match self {
            Self::Alert50 => Some(format!(
                "Budget alert {}",
                threshold_label(thresholds.advisory)
            )),
            Self::Alert75 => Some(format!(
                "Budget alert {}",
                threshold_label(thresholds.warning)
            )),
            Self::Alert90 => Some(format!(
                "Budget alert {}",
                threshold_label(thresholds.critical)
            )),
            Self::OverBudget => Some("Budget exceeded".to_string()),
            Self::Unconfigured | Self::Normal => None,
        }
    }

    pub(crate) fn style(self) -> Style {
        let base = Style::default().fg(match self {
            Self::Unconfigured => Color::DarkGray,
            Self::Normal => Color::DarkGray,
            Self::Alert50 => Color::Cyan,
            Self::Alert75 => Color::Yellow,
            Self::Alert90 => Color::LightRed,
            Self::OverBudget => Color::Red,
        });

        if matches!(self, Self::Alert75 | Self::Alert90 | Self::OverBudget) {
            base.add_modifier(Modifier::BOLD)
        } else {
            base
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum MeterFormat {
    Tokens,
    Currency,
}

#[derive(Debug, Clone)]
pub(crate) struct TokenMeter<'a> {
    title: &'a str,
    used: f64,
    budget: f64,
    thresholds: BudgetAlertThresholds,
    format: MeterFormat,
}

impl<'a> TokenMeter<'a> {
    pub(crate) fn tokens(
        title: &'a str,
        used: u64,
        budget: u64,
        thresholds: BudgetAlertThresholds,
    ) -> Self {
        Self {
            title,
            used: used as f64,
            budget: budget as f64,
            thresholds,
            format: MeterFormat::Tokens,
        }
    }

    pub(crate) fn currency(
        title: &'a str,
        used: f64,
        budget: f64,
        thresholds: BudgetAlertThresholds,
    ) -> Self {
        Self {
            title,
            used,
            budget,
            thresholds,
            format: MeterFormat::Currency,
        }
    }

    pub(crate) fn state(&self) -> BudgetState {
        budget_state(self.used, self.budget, self.thresholds)
    }

    fn ratio(&self) -> f64 {
        budget_ratio(self.used, self.budget)
    }

    fn clamped_ratio(&self) -> f64 {
        self.ratio().clamp(0.0, 1.0)
    }

    fn title_line(&self) -> Line<'static> {
        let mut spans = vec![Span::styled(
            self.title.to_string(),
            Style::default()
                .fg(Color::Gray)
                .add_modifier(Modifier::BOLD),
        )];

        if let Some(badge) = self.state().badge(self.thresholds) {
            spans.push(Span::raw(" "));
            spans.push(Span::styled(format!("[{badge}]"), self.state().style()));
        }

        Line::from(spans)
    }

    fn display_label(&self) -> String {
        if self.budget <= 0.0 {
            return match self.format {
                MeterFormat::Tokens => format!("{} tok used | no budget", self.used_label()),
                MeterFormat::Currency => format!("{} spent | no budget", self.used_label()),
            };
        }

        format!(
            "{} / {}{} ({}%)",
            self.used_label(),
            self.budget_label(),
            self.unit_suffix(),
            (self.ratio() * 100.0).round() as u64
        )
    }

    fn used_label(&self) -> String {
        match self.format {
            MeterFormat::Tokens => format_token_count(self.used.max(0.0).round() as u64),
            MeterFormat::Currency => format_currency(self.used.max(0.0)),
        }
    }

    fn budget_label(&self) -> String {
        match self.format {
            MeterFormat::Tokens => format_token_count(self.budget.max(0.0).round() as u64),
            MeterFormat::Currency => format_currency(self.budget.max(0.0)),
        }
    }

    fn unit_suffix(&self) -> &'static str {
        match self.format {
            MeterFormat::Tokens => " tok",
            MeterFormat::Currency => "",
        }
    }
}

impl Widget for TokenMeter<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.is_empty() {
            return;
        }

        let mut gauge_area = area;
        if area.height > 1 {
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(1), Constraint::Min(1)])
                .split(area);
            Paragraph::new(self.title_line()).render(chunks[0], buf);
            gauge_area = chunks[1];
        }

        Gauge::default()
            .ratio(self.clamped_ratio())
            .label(self.display_label())
            .gauge_style(
                Style::default()
                    .fg(gradient_color(self.ratio(), self.thresholds))
                    .add_modifier(Modifier::BOLD),
            )
            .style(Style::default().fg(Color::DarkGray))
            .use_unicode(true)
            .render(gauge_area, buf);
    }
}

pub(crate) fn budget_ratio(used: f64, budget: f64) -> f64 {
    if budget <= 0.0 {
        0.0
    } else {
        used / budget
    }
}

pub(crate) fn budget_state(
    used: f64,
    budget: f64,
    thresholds: BudgetAlertThresholds,
) -> BudgetState {
    if budget <= 0.0 {
        BudgetState::Unconfigured
    } else if used / budget >= 1.0 {
        BudgetState::OverBudget
    } else if used / budget >= thresholds.critical {
        BudgetState::Alert90
    } else if used / budget >= thresholds.warning {
        BudgetState::Alert75
    } else if used / budget >= thresholds.advisory {
        BudgetState::Alert50
    } else {
        BudgetState::Normal
    }
}

pub(crate) fn gradient_color(ratio: f64, thresholds: BudgetAlertThresholds) -> Color {
    const GREEN: (u8, u8, u8) = (34, 197, 94);
    const YELLOW: (u8, u8, u8) = (234, 179, 8);
    const RED: (u8, u8, u8) = (239, 68, 68);

    let clamped = ratio.clamp(0.0, 1.0);
    if clamped <= thresholds.warning {
        interpolate_rgb(
            GREEN,
            YELLOW,
            clamped / thresholds.warning.max(f64::EPSILON),
        )
    } else {
        interpolate_rgb(
            YELLOW,
            RED,
            (clamped - thresholds.warning) / (1.0 - thresholds.warning),
        )
    }
}

fn threshold_label(value: f64) -> String {
    format!("{}%", (value * 100.0).round() as u64)
}

pub(crate) fn format_currency(value: f64) -> String {
    format!("${value:.2}")
}

pub(crate) fn format_token_count(value: u64) -> String {
    let digits = value.to_string();
    let mut formatted = String::with_capacity(digits.len() + digits.len() / 3);

    for (index, ch) in digits.chars().rev().enumerate() {
        if index != 0 && index % 3 == 0 {
            formatted.push(',');
        }
        formatted.push(ch);
    }

    formatted.chars().rev().collect()
}

fn interpolate_rgb(from: (u8, u8, u8), to: (u8, u8, u8), ratio: f64) -> Color {
    let ratio = ratio.clamp(0.0, 1.0);
    let channel = |start: u8, end: u8| -> u8 {
        (f64::from(start) + (f64::from(end) - f64::from(start)) * ratio).round() as u8
    };

    Color::Rgb(
        channel(from.0, to.0),
        channel(from.1, to.1),
        channel(from.2, to.2),
    )
}

#[cfg(test)]
mod tests {
    use ratatui::{buffer::Buffer, layout::Rect, style::Color, widgets::Widget};

    use crate::config::{BudgetAlertThresholds, Config};

    use super::{gradient_color, threshold_label, BudgetState, TokenMeter};

    #[test]
    fn budget_state_uses_alert_threshold_ladder() {
        assert_eq!(
            TokenMeter::tokens("Token Budget", 50, 100, Config::BUDGET_ALERT_THRESHOLDS).state(),
            BudgetState::Alert50
        );
        assert_eq!(
            TokenMeter::tokens("Token Budget", 75, 100, Config::BUDGET_ALERT_THRESHOLDS).state(),
            BudgetState::Alert75
        );
        assert_eq!(
            TokenMeter::tokens("Token Budget", 90, 100, Config::BUDGET_ALERT_THRESHOLDS).state(),
            BudgetState::Alert90
        );
        assert_eq!(
            TokenMeter::tokens("Token Budget", 100, 100, Config::BUDGET_ALERT_THRESHOLDS).state(),
            BudgetState::OverBudget
        );
    }

    #[test]
    fn gradient_runs_from_green_to_yellow_to_red() {
        assert_eq!(
            gradient_color(0.0, Config::BUDGET_ALERT_THRESHOLDS),
            Color::Rgb(34, 197, 94)
        );
        assert_eq!(
            gradient_color(0.75, Config::BUDGET_ALERT_THRESHOLDS),
            Color::Rgb(234, 179, 8)
        );
        assert_eq!(
            gradient_color(1.0, Config::BUDGET_ALERT_THRESHOLDS),
            Color::Rgb(239, 68, 68)
        );
    }

    #[test]
    fn token_meter_uses_custom_budget_thresholds() {
        let meter = TokenMeter::tokens(
            "Token Budget",
            45,
            100,
            BudgetAlertThresholds {
                advisory: 0.40,
                warning: 0.70,
                critical: 0.85,
            },
        );

        assert_eq!(meter.state(), BudgetState::Alert50);
    }

    #[test]
    fn threshold_label_rounds_to_percent() {
        assert_eq!(threshold_label(0.4), "40%");
        assert_eq!(threshold_label(0.875), "88%");
    }

    #[test]
    fn token_meter_renders_compact_usage_label() {
        let meter = TokenMeter::tokens(
            "Token Budget",
            4_000,
            10_000,
            Config::BUDGET_ALERT_THRESHOLDS,
        );
        let area = Rect::new(0, 0, 48, 2);
        let mut buffer = Buffer::empty(area);

        meter.render(area, &mut buffer);

        let rendered = buffer
            .content()
            .chunks(area.width as usize)
            .flat_map(|row| row.iter().map(|cell| cell.symbol()))
            .collect::<String>();

        assert!(rendered.contains("4,000 / 10,000 tok (40%)"));
    }
}
