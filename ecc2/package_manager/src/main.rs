use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use regex::Regex;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use once_cell::sync::Lazy;

// Safe name regex: alphanumeric, dash, underscore, dot, slash, @
static SAFE_NAME_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[@a-zA-Z0-9_./-]+$").unwrap());

// Safe args regex: alphanumeric, whitespace, dashes, dots, slashes, equals, colons, commas, quotes, @, *, +
static SAFE_ARGS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"^[@a-zA-Z0-9\s_./:=,'"*+-]+$"#).unwrap());

#[derive(Error, Debug)]
pub enum PackageManagerError {
    #[error("Failed to read/write file: {0}")]
    Io(#[from] std::io::Error),

    #[error("Failed to parse JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Unknown package manager: {0}")]
    UnknownPackageManager(String),

    #[error("Script name must not be empty")]
    EmptyScriptName,

    #[error("Script name contains unsafe characters: {0}")]
    UnsafeScriptName(String),

    #[error("Binary name must not be empty")]
    EmptyBinaryName,

    #[error("Binary name contains unsafe characters: {0}")]
    UnsafeBinaryName(String),

    #[error("Arguments contain unsafe characters: {0}")]
    UnsafeArguments(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackageManagerConfig {
    pub name: String,
    pub lock_file: String,
    pub lock_file_aliases: Vec<String>,
    pub install_cmd: String,
    pub run_cmd: String,
    pub exec_cmd: String,
    pub test_cmd: String,
    pub build_cmd: String,
    pub dev_cmd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigFile {
    #[serde(rename = "packageManager")]
    pub package_manager: String,
    #[serde(rename = "setAt")]
    pub set_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PackageJson {
    #[serde(rename = "packageManager")]
    package_manager: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DetectionSource {
    Environment,
    ProjectConfig,
    PackageJson,
    LockFile,
    GlobalConfig,
    Default,
}

#[derive(Debug, Clone)]
pub struct DetectionResult {
    pub name: String,
    pub config: PackageManagerConfig,
    pub source: DetectionSource,
}

pub struct PackageManagerManager {
    managers: HashMap<String, PackageManagerConfig>,
    detection_priority: Vec<String>,
}

impl Default for PackageManagerManager {
    fn default() -> Self {
        let mut managers = HashMap::new();

        managers.insert(
            "npm".to_string(),
            PackageManagerConfig {
                name: "npm".into(),
                lock_file: "package-lock.json".into(),
                lock_file_aliases: vec![],
                install_cmd: "npm install".into(),
                run_cmd: "npm run".into(),
                exec_cmd: "npx".into(),
                test_cmd: "npm test".into(),
                build_cmd: "npm run build".into(),
                dev_cmd: "npm run dev".into(),
            },
        );

        managers.insert(
            "pnpm".to_string(),
            PackageManagerConfig {
                name: "pnpm".into(),
                lock_file: "pnpm-lock.yaml".into(),
                lock_file_aliases: vec![],
                install_cmd: "pnpm install".into(),
                run_cmd: "pnpm".into(),
                exec_cmd: "pnpm dlx".into(),
                test_cmd: "pnpm test".into(),
                build_cmd: "pnpm build".into(),
                dev_cmd: "pnpm dev".into(),
            },
        );

        managers.insert(
            "yarn".to_string(),
            PackageManagerConfig {
                name: "yarn".into(),
                lock_file: "yarn.lock".into(),
                lock_file_aliases: vec![],
                install_cmd: "yarn".into(),
                run_cmd: "yarn".into(),
                exec_cmd: "yarn dlx".into(),
                test_cmd: "yarn test".into(),
                build_cmd: "yarn build".into(),
                dev_cmd: "yarn dev".into(),
            },
        );

        managers.insert(
            "bun".to_string(),
            PackageManagerConfig {
                name: "bun".into(),
                lock_file: "bun.lock".into(),
                lock_file_aliases: vec!["bun.lockb".into()],
                install_cmd: "bun install".into(),
                run_cmd: "bun run".into(),
                exec_cmd: "bunx".into(),
                test_cmd: "bun test".into(),
                build_cmd: "bun run build".into(),
                dev_cmd: "bun run dev".into(),
            },
        );

        Self {
            managers,
            detection_priority: vec![
                "pnpm".into(),
                "bun".into(),
                "yarn".into(),
                "npm".into(),
            ],
        }
    }
}

impl PackageManagerManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Get Claude configuration directory path
    fn get_claude_dir(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".claude")
    }

    fn get_config_path(&self) -> PathBuf {
        self.get_claude_dir().join("package-manager.json")
    }

    /// Load saved global package manager configuration
    pub fn load_config(&self) -> Option<ConfigFile> {
        let path = self.get_config_path();
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// Save global package manager configuration
    pub fn save_config(&self, config: &ConfigFile) -> Result<(), PackageManagerError> {
        let dir = self.get_claude_dir();
        if !dir.exists() {
            fs::create_dir_all(&dir)?;
        }
        let content = serde_json::to_string_pretty(config)?;
        fs::write(self.get_config_path(), content)?;
        Ok(())
    }

    /// Detect package manager from lock file in project directory
    pub fn detect_from_lock_file(&self, project_dir: &Path) -> Option<String> {
        for pm_name in &self.detection_priority {
            if let Some(pm) = self.managers.get(pm_name) {
                if project_dir.join(&pm.lock_file).exists() {
                    return Some(pm_name.clone());
                }
                for alias in &pm.lock_file_aliases {
                    if project_dir.join(alias).exists() {
                        return Some(pm_name.clone());
                    }
                }
            }
        }
        None
    }

    /// Detect package manager from package.json packageManager field
    pub fn detect_from_package_json(&self, project_dir: &Path) -> Option<String> {
        let pkg_path = project_dir.join("package.json");
        let content = fs::read_to_string(pkg_path).ok()?;
        let pkg: PackageJson = serde_json::from_str(&content).ok()?;

        if let Some(pm_field) = pkg.package_manager {
            let pm_name = pm_field.split('@').next()?;
            if self.managers.contains_key(pm_name) {
                return Some(pm_name.to_string());
            }
        }
        None
    }

    /// Get available package managers (installed on system)
    /// WARNING: This uses 'which' crate which may spawn processes or perform heavy syscalls.
    /// Do NOT call this during session startup hooks.
    pub fn get_available_package_managers(&self) -> Vec<String> {
        self.managers
            .keys()
            .filter(|&pm| which::which(pm).is_ok())
            .cloned()
            .collect()
    }

    /// Get the package manager to use for current project
    pub fn get_package_manager(&self, project_dir: Option<&Path>) -> DetectionResult {
        let default_cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let proj_dir = project_dir.unwrap_or(&default_cwd);

        // 1. Check environment variable
        if let Ok(env_pm) = env::var("CLAUDE_PACKAGE_MANAGER") {
            if let Some(config) = self.managers.get(&env_pm) {
                return DetectionResult {
                    name: env_pm,
                    config: config.clone(),
                    source: DetectionSource::Environment,
                };
            }
        }

        // 2. Check project-specific config
        let proj_config_path = proj_dir.join(".claude").join("package-manager.json");
        if let Ok(content) = fs::read_to_string(&proj_config_path) {
            if let Ok(config) = serde_json::from_str::<ConfigFile>(&content) {
                if let Some(pm_config) = self.managers.get(&config.package_manager) {
                    return DetectionResult {
                        name: config.package_manager,
                        config: pm_config.clone(),
                        source: DetectionSource::ProjectConfig,
                    };
                }
            }
        }

        // 3. Check package.json packageManager field
        if let Some(pm_name) = self.detect_from_package_json(proj_dir) {
            return DetectionResult {
                name: pm_name.clone(),
                config: self.managers[&pm_name].clone(),
                source: DetectionSource::PackageJson,
            };
        }

        // 4. Check lock file
        if let Some(pm_name) = self.detect_from_lock_file(proj_dir) {
            return DetectionResult {
                name: pm_name.clone(),
                config: self.managers[&pm_name].clone(),
                source: DetectionSource::LockFile,
            };
        }

        // 5. Check global user preference
        if let Some(global_config) = self.load_config() {
            if let Some(pm_config) = self.managers.get(&global_config.package_manager) {
                return DetectionResult {
                    name: global_config.package_manager,
                    config: pm_config.clone(),
                    source: DetectionSource::GlobalConfig,
                };
            }
        }

        // 6. Default to npm
        DetectionResult {
            name: "npm".into(),
            config: self.managers["npm"].clone(),
            source: DetectionSource::Default,
        }
    }

    /// Set user's preferred package manager (global)
    pub fn set_preferred_package_manager(
        &self,
        pm_name: &str,
    ) -> Result<ConfigFile, PackageManagerError> {
        if !self.managers.contains_key(pm_name) {
            return Err(PackageManagerError::UnknownPackageManager(pm_name.into()));
        }

        let config = ConfigFile {
            package_manager: pm_name.into(),
            set_at: Some(chrono::Utc::now().to_rfc3339()),
        };

        self.save_config(&config)?;
        Ok(config)
    }

    /// Set project's preferred package manager
    pub fn set_project_package_manager(
        &self,
        pm_name: &str,
        project_dir: Option<&Path>,
    ) -> Result<ConfigFile, PackageManagerError> {
        if !self.managers.contains_key(pm_name) {
            return Err(PackageManagerError::UnknownPackageManager(pm_name.into()));
        }

        let default_cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let proj_dir = project_dir.unwrap_or(&default_cwd);
        let config_dir = proj_dir.join(".claude");

        if !config_dir.exists() {
            fs::create_dir_all(&config_dir)?;
        }

        let config = ConfigFile {
            package_manager: pm_name.into(),
            set_at: Some(chrono::Utc::now().to_rfc3339()),
        };

        let config_path = config_dir.join("package-manager.json");
        let content = serde_json::to_string_pretty(&config)?;
        fs::write(config_path, content)?;

        Ok(config)
    }

    /// Validate script/binary names
    fn is_safe_name(name: &str) -> bool {
        SAFE_NAME_RE.is_match(name)
    }

    /// Validate arguments
    fn is_safe_args(args: &str) -> bool {
        SAFE_ARGS_RE.is_match(args)
    }

    /// Get the command to run a script
    pub fn get_run_command(
        &self,
        script: &str,
        project_dir: Option<&Path>,
    ) -> Result<String, PackageManagerError> {
        if script.trim().is_empty() {
            return Err(PackageManagerError::EmptyScriptName);
        }
        if !Self::is_safe_name(script) {
            return Err(PackageManagerError::UnsafeScriptName(script.into()));
        }

        let pm = self.get_package_manager(project_dir);

        Ok(match script {
            "install" => pm.config.install_cmd.clone(),
            "test" => pm.config.test_cmd.clone(),
            "build" => pm.config.build_cmd.clone(),
            "dev" => pm.config.dev_cmd.clone(),
            _ => format!("{} {}", pm.config.run_cmd, script),
        })
    }

    /// Get the command to execute a package binary
    pub fn get_exec_command(
        &self,
        binary: &str,
        args: Option<&str>,
        project_dir: Option<&Path>,
    ) -> Result<String, PackageManagerError> {
        if binary.trim().is_empty() {
            return Err(PackageManagerError::EmptyBinaryName);
        }
        if !Self::is_safe_name(binary) {
            return Err(PackageManagerError::UnsafeBinaryName(binary.into()));
        }
        if let Some(a) = args {
            if !a.is_empty() && !Self::is_safe_args(a) {
                return Err(PackageManagerError::UnsafeArguments(a.into()));
            }
        }

        let pm = self.get_package_manager(project_dir);
        let args_str = args.map(|a| format!(" {}", a)).unwrap_or_default();

        Ok(format!("{} {}{}", pm.config.exec_cmd, binary, args_str))
    }

    /// Interactive prompt for package manager selection
    pub fn get_selection_prompt(&self) -> String {
        let mut keys: Vec<&String> = self.managers.keys().collect();
        keys.sort();
        let managers_list = keys.into_iter().cloned().collect::<Vec<_>>().join(", ");

        format!(
            "[PackageManager] No package manager preference detected.\n\
             Supported package managers: {}\n\n\
             To set your preferred package manager:\n\
             \x20 - Global: Set CLAUDE_PACKAGE_MANAGER environment variable\n\
             \x20 - Or add to ~/.claude/package-manager.json: {{\"packageManager\": \"pnpm\"}}\n\
             \x20 - Or add to package.json: {{\"packageManager\": \"pnpm@8\"}}\n\
             \x20 - Or add a lock file to your project (e.g., pnpm-lock.yaml)\n",
            managers_list
        )
    }

    /// Generate a regex pattern that matches commands for all package managers
    pub fn get_command_pattern(&self, action: &str) -> String {
        let trimmed = action.trim();
        let mut patterns = Vec::new();

        match trimmed {
            "dev" => {
                patterns.push("npm run dev".to_string());
                patterns.push("pnpm( run)? dev".to_string());
                patterns.push("yarn dev".to_string());
                patterns.push("bun run dev".to_string());
            }
            "install" => {
                patterns.push("npm install".to_string());
                patterns.push("pnpm install".to_string());
                patterns.push("yarn( install)?".to_string());
                patterns.push("bun install".to_string());
            }
            "test" => {
                patterns.push("npm test".to_string());
                patterns.push("pnpm test".to_string());
                patterns.push("yarn test".to_string());
                patterns.push("bun test".to_string());
            }
            "build" => {
                patterns.push("npm run build".to_string());
                patterns.push("pnpm( run)? build".to_string());
                patterns.push("yarn build".to_string());
                patterns.push("bun run build".to_string());
            }
            _ => {
                let escaped = regex::escape(trimmed);
                patterns.push(format!("npm run {}", escaped));
                patterns.push(format!("pnpm( run)? {}", escaped));
                patterns.push(format!("yarn {}", escaped));
                patterns.push(format!("bun run {}", escaped));
            }
        }

        format!("({})", patterns.join("|"))
    }
} 

fn main() {
    let current_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    println!("Program successfully started in folder: {:?}", current_dir);
}