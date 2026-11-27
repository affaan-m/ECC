use anyhow::Result;
use chrono::{DateTime, Local, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[cfg(not(test))]
use anyhow::Context;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationEvent {
    SessionStarted,
    SessionCompleted,
    SessionFailed,
    BudgetAlert,
    ApprovalRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuietHoursConfig {
    pub enabled: bool,
    pub start_hour: u8,
    pub end_hour: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct DesktopNotificationConfig {
    pub enabled: bool,
    pub session_started: bool,
    pub session_completed: bool,
    pub session_failed: bool,
    pub budget_alerts: bool,
    pub approval_requests: bool,
    pub quiet_hours: QuietHoursConfig,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompletionSummaryDelivery {
    #[default]
    Desktop,
    TuiPopup,
    DesktopAndTuiPopup,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CompletionSummaryConfig {
    pub enabled: bool,
    pub delivery: CompletionSummaryDelivery,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookProvider {
    #[default]
    Slack,
    Discord,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WebhookTarget {
    pub provider: WebhookProvider,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WebhookNotificationConfig {
    pub enabled: bool,
    pub session_started: bool,
    pub session_completed: bool,
    pub session_failed: bool,
    pub budget_alerts: bool,
    pub approval_requests: bool,
    pub targets: Vec<WebhookTarget>,
}

#[derive(Debug, Clone)]
pub struct DesktopNotifier {
    config: DesktopNotificationConfig,
}

#[derive(Debug, Clone)]
pub struct WebhookNotifier {
    config: WebhookNotificationConfig,
}

impl Default for QuietHoursConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            start_hour: 22,
            end_hour: 8,
        }
    }
}

impl QuietHoursConfig {
    pub fn sanitized(self) -> Self {
        let valid = self.start_hour <= 23 && self.end_hour <= 23;
        if valid {
            self
        } else {
            Self::default()
        }
    }

    pub fn is_active(&self, now: DateTime<Local>) -> bool {
        if !self.enabled {
            return false;
        }

        let quiet = self.clone().sanitized();
        if quiet.start_hour == quiet.end_hour {
            return false;
        }

        let hour = now.hour() as u8;
        if quiet.start_hour < quiet.end_hour {
            hour >= quiet.start_hour && hour < quiet.end_hour
        } else {
            hour >= quiet.start_hour || hour < quiet.end_hour
        }
    }
}

impl Default for DesktopNotificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            session_started: false,
            session_completed: true,
            session_failed: true,
            budget_alerts: true,
            approval_requests: true,
            quiet_hours: QuietHoursConfig::default(),
        }
    }
}

impl DesktopNotificationConfig {
    pub fn sanitized(self) -> Self {
        Self {
            quiet_hours: self.quiet_hours.sanitized(),
            ..self
        }
    }

    pub fn allows(&self, event: NotificationEvent, now: DateTime<Local>) -> bool {
        let config = self.clone().sanitized();
        if !config.enabled || config.quiet_hours.is_active(now) {
            return false;
        }

        match event {
            NotificationEvent::SessionStarted => config.session_started,
            NotificationEvent::SessionCompleted => config.session_completed,
            NotificationEvent::SessionFailed => config.session_failed,
            NotificationEvent::BudgetAlert => config.budget_alerts,
            NotificationEvent::ApprovalRequest => config.approval_requests,
        }
    }
}

impl Default for CompletionSummaryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            delivery: CompletionSummaryDelivery::Desktop,
        }
    }
}

impl CompletionSummaryConfig {
    pub fn desktop_enabled(&self) -> bool {
        self.enabled
            && matches!(
                self.delivery,
                CompletionSummaryDelivery::Desktop | CompletionSummaryDelivery::DesktopAndTuiPopup
            )
    }

    pub fn popup_enabled(&self) -> bool {
        self.enabled
            && matches!(
                self.delivery,
                CompletionSummaryDelivery::TuiPopup | CompletionSummaryDelivery::DesktopAndTuiPopup
            )
    }
}

impl Default for WebhookTarget {
    fn default() -> Self {
        Self {
            provider: WebhookProvider::Slack,
            url: String::new(),
        }
    }
}

impl WebhookTarget {
    fn sanitized(self) -> Option<Self> {
        let url = self.url.trim().to_string();
        if url.starts_with("https://") || url.starts_with("http://") {
            Some(Self { url, ..self })
        } else {
            None
        }
    }
}

impl Default for WebhookNotificationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            session_started: true,
            session_completed: true,
            session_failed: true,
            budget_alerts: true,
            approval_requests: false,
            targets: Vec::new(),
        }
    }
}

impl WebhookNotificationConfig {
    pub fn sanitized(self) -> Self {
        Self {
            targets: self
                .targets
                .into_iter()
                .filter_map(WebhookTarget::sanitized)
                .collect(),
            ..self
        }
    }

    pub fn allows(&self, event: NotificationEvent) -> bool {
        let config = self.clone().sanitized();
        if !config.enabled || config.targets.is_empty() {
            return false;
        }

        match event {
            NotificationEvent::SessionStarted => config.session_started,
            NotificationEvent::SessionCompleted => config.session_completed,
            NotificationEvent::SessionFailed => config.session_failed,
            NotificationEvent::BudgetAlert => config.budget_alerts,
            NotificationEvent::ApprovalRequest => config.approval_requests,
        }
    }
}

impl DesktopNotifier {
    pub fn new(config: DesktopNotificationConfig) -> Self {
        Self {
            config: config.sanitized(),
        }
    }

    pub fn notify(&self, event: NotificationEvent, title: &str, body: &str) -> bool {
        match self.try_notify(event, title, body, Local::now()) {
            Ok(sent) => sent,
            Err(error) => {
                tracing::warn!("Failed to send desktop notification: {error}");
                false
            }
        }
    }

    fn try_notify(
        &self,
        event: NotificationEvent,
        title: &str,
        body: &str,
        now: DateTime<Local>,
    ) -> Result<bool> {
        if !self.config.allows(event, now) {
            return Ok(false);
        }

        let Some((program, args)) = notification_command(std::env::consts::OS, title, body) else {
            return Ok(false);
        };

        run_notification_command(&program, &args)?;
        Ok(true)
    }
}

impl WebhookNotifier {
    pub fn new(config: WebhookNotificationConfig) -> Self {
        Self {
            config: config.sanitized(),
        }
    }

    pub fn notify(&self, event: NotificationEvent, message: &str) -> bool {
        match self.try_notify(event, message) {
            Ok(sent) => sent,
            Err(error) => {
                tracing::warn!("Failed to send webhook notification: {error}");
                false
            }
        }
    }

    fn try_notify(&self, event: NotificationEvent, message: &str) -> Result<bool> {
        self.try_notify_with(event, message, send_webhook_request)
    }

    fn try_notify_with<F>(
        &self,
        event: NotificationEvent,
        message: &str,
        mut sender: F,
    ) -> Result<bool>
    where
        F: FnMut(&WebhookTarget, serde_json::Value) -> Result<()>,
    {
        if !self.config.allows(event) {
            return Ok(false);
        }

        let mut delivered = false;
        for target in &self.config.targets {
            let payload = webhook_payload(target, message);
            match sender(target, payload) {
                Ok(()) => delivered = true,
                Err(error) => tracing::warn!(
                    "Failed to deliver {:?} webhook notification to {}: {error}",
                    target.provider,
                    target.url
                ),
            }
        }

        Ok(delivered)
    }
}

fn notification_command(platform: &str, title: &str, body: &str) -> Option<(String, Vec<String>)> {
    match platform {
        "macos" => Some((
            "osascript".to_string(),
            vec![
                "-e".to_string(),
                format!(
                    "display notification \"{}\" with title \"{}\"",
                    sanitize_osascript(body),
                    sanitize_osascript(title)
                ),
            ],
        )),
        "linux" => Some((
            "notify-send".to_string(),
            vec![
                "--app-name".to_string(),
                "ECC 2.0".to_string(),
                title.trim().to_string(),
                body.trim().to_string(),
            ],
        )),
        _ => None,
    }
}

fn webhook_payload(target: &WebhookTarget, message: &str) -> serde_json::Value {
    match target.provider {
        WebhookProvider::Slack => json!({
            "text": message,
        }),
        WebhookProvider::Discord => json!({
            "content": message,
            "allowed_mentions": {
                "parse": []
            }
        }),
    }
}

#[cfg(not(test))]
fn run_notification_command(program: &str, args: &[String]) -> Result<()> {
    let status = std::process::Command::new(program)
        .args(args)
        .status()
        .with_context(|| format!("launch {program}"))?;

    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("{program} exited with {status}");
    }
}

#[cfg(test)]
fn run_notification_command(_program: &str, _args: &[String]) -> Result<()> {
    Ok(())
}

#[cfg(not(test))]
fn send_webhook_request(target: &WebhookTarget, payload: serde_json::Value) -> Result<()> {
    let agent = ureq::Agent::config_builder()
        .timeout_connect(Some(std::time::Duration::from_secs(5)))
        .timeout_recv_response(Some(std::time::Duration::from_secs(5)))
        .build()
        .new_agent();
    let response = agent
        .post(&target.url)
        .send_json(payload)
        .with_context(|| format!("POST {}", target.url))?;

    if response.status().is_success() {
        Ok(())
    } else {
        anyhow::bail!("{} returned {}", target.url, response.status());
    }
}

#[cfg(test)]
fn send_webhook_request(_target: &WebhookTarget, _payload: serde_json::Value) -> Result<()> {
    Ok(())
}

fn sanitize_osascript(value: &str) -> String {
    value
        .replace('\\', "")
        .replace('"', "\u{201C}")
        .replace('\n', " ")
}

#[cfg(test)]
mod tests {
    use super::{
        notification_command, webhook_payload, CompletionSummaryDelivery,
        DesktopNotificationConfig, DesktopNotifier, NotificationEvent, QuietHoursConfig,
        WebhookNotificationConfig, WebhookNotifier, WebhookProvider, WebhookTarget,
    };
    use chrono::{Local, TimeZone};
    use serde_json::json;

    #[test]
    fn quiet_hours_support_cross_midnight_ranges() {
        let quiet_hours = QuietHoursConfig {
            enabled: true,
            start_hour: 22,
            end_hour: 8,
        };

        assert!(quiet_hours.is_active(Local.with_ymd_and_hms(2026, 4, 9, 23, 0, 0).unwrap()));
        assert!(quiet_hours.is_active(Local.with_ymd_and_hms(2026, 4, 9, 7, 0, 0).unwrap()));
        assert!(!quiet_hours.is_active(Local.with_ymd_and_hms(2026, 4, 9, 14, 0, 0).unwrap()));
    }

    #[test]
    fn quiet_hours_support_same_day_ranges() {
        let quiet_hours = QuietHoursConfig {
            enabled: true,
            start_hour: 9,
            end_hour: 17,
        };

        assert!(quiet_hours.is_active(Local.with_ymd_and_hms(2026, 4, 9, 10, 0, 0).unwrap()));
        assert!(!quiet_hours.is_active(Local.with_ymd_and_hms(2026, 4, 9, 18, 0, 0).unwrap()));
    }

    #[test]
    fn notification_preferences_respect_event_flags() {
        let mut config = DesktopNotificationConfig::default();
        config.session_completed = false;
        let now = Local.with_ymd_and_hms(2026, 4, 9, 12, 0, 0).unwrap();

        assert!(!config.allows(NotificationEvent::SessionCompleted, now));
        assert!(config.allows(NotificationEvent::BudgetAlert, now));
        assert!(!config.allows(NotificationEvent::SessionStarted, now));
    }

    #[test]
    fn notifier_skips_delivery_during_quiet_hours() {
        let mut config = DesktopNotificationConfig::default();
        config.quiet_hours = QuietHoursConfig {
            enabled: true,
            start_hour: 22,
            end_hour: 8,
        };
        let notifier = DesktopNotifier::new(config);

        assert!(!notifier
            .try_notify(
                NotificationEvent::ApprovalRequest,
                "ECC 2.0: Approval needed",
                "worker-123 needs review",
                Local.with_ymd_and_hms(2026, 4, 9, 23, 0, 0).unwrap(),
            )
            .unwrap());
    }

    #[test]
    fn macos_notifications_use_osascript() {
        let (program, args) =
            notification_command("macos", "ECC 2.0: Completed", "Task finished").unwrap();

        assert_eq!(program, "osascript");
        assert_eq!(args[0], "-e");
        assert!(args[1].contains("display notification"));
        assert!(args[1].contains("ECC 2.0: Completed"));
    }

    #[test]
    fn linux_notifications_use_notify_send() {
        let (program, args) =
            notification_command("linux", "ECC 2.0: Approval needed", "worker-123").unwrap();

        assert_eq!(program, "notify-send");
        assert_eq!(args[0], "--app-name");
        assert_eq!(args[1], "ECC 2.0");
        assert_eq!(args[2], "ECC 2.0: Approval needed");
        assert_eq!(args[3], "worker-123");
    }

    #[test]
    fn webhook_notifications_require_enabled_targets_and_event() {
        let mut config = WebhookNotificationConfig::default();
        assert!(!config.allows(NotificationEvent::SessionCompleted));

        config.enabled = true;
        config.targets = vec![WebhookTarget {
            provider: WebhookProvider::Slack,
            url: "https://hooks.slack.test/services/abc".to_string(),
        }];

        assert!(config.allows(NotificationEvent::SessionCompleted));
        assert!(config.allows(NotificationEvent::SessionStarted));
        assert!(!config.allows(NotificationEvent::ApprovalRequest));
    }

    #[test]
    fn webhook_sanitization_filters_invalid_urls() {
        let config = WebhookNotificationConfig {
            enabled: true,
            targets: vec![
                WebhookTarget {
                    provider: WebhookProvider::Slack,
                    url: "https://hooks.slack.test/services/abc".to_string(),
                },
                WebhookTarget {
                    provider: WebhookProvider::Discord,
                    url: "ftp://discord.invalid".to_string(),
                },
            ],
            ..WebhookNotificationConfig::default()
        }
        .sanitized();

        assert_eq!(config.targets.len(), 1);
        assert_eq!(config.targets[0].provider, WebhookProvider::Slack);
    }

    #[test]
    fn slack_webhook_payload_uses_text() {
        let payload = webhook_payload(
            &WebhookTarget {
                provider: WebhookProvider::Slack,
                url: "https://hooks.slack.test/services/abc".to_string(),
            },
            "*ECC 2.0* hello",
        );

        assert_eq!(payload, json!({ "text": "*ECC 2.0* hello" }));
    }

    #[test]
    fn discord_webhook_payload_disables_mentions() {
        let payload = webhook_payload(
            &WebhookTarget {
                provider: WebhookProvider::Discord,
                url: "https://discord.test/api/webhooks/123".to_string(),
            },
            "```text\nsummary\n```",
        );

        assert_eq!(
            payload,
            json!({
                "content": "```text\nsummary\n```",
                "allowed_mentions": { "parse": [] }
            })
        );
    }

    #[test]
    fn webhook_notifier_sends_to_each_target() {
        let notifier = WebhookNotifier::new(WebhookNotificationConfig {
            enabled: true,
            targets: vec![
                WebhookTarget {
                    provider: WebhookProvider::Slack,
                    url: "https://hooks.slack.test/services/abc".to_string(),
                },
                WebhookTarget {
                    provider: WebhookProvider::Discord,
                    url: "https://discord.test/api/webhooks/123".to_string(),
                },
            ],
            ..WebhookNotificationConfig::default()
        });
        let mut sent = Vec::new();

        let delivered = notifier
            .try_notify_with(
                NotificationEvent::SessionCompleted,
                "payload text",
                |target, payload| {
                    sent.push((target.provider, payload));
                    Ok(())
                },
            )
            .unwrap();

        assert!(delivered);
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[0].0, WebhookProvider::Slack);
        assert_eq!(sent[1].0, WebhookProvider::Discord);
    }

    #[test]
    fn completion_summary_delivery_defaults_to_desktop() {
        assert_eq!(
            CompletionSummaryDelivery::default(),
            CompletionSummaryDelivery::Desktop
        );
    }
}
