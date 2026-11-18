pub mod android;
pub mod automation;
#[cfg(target_arch = "wasm32")]
mod bridge;
pub mod host;
pub mod ios;
pub mod project;
mod syntax;
pub mod transaction;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::ops::Range;

#[derive(Debug, Serialize)]
pub struct Error {
    pub code: &'static str,
    pub message: String,
    pub path: String,
    pub details: Value,
}
pub type Result<T> = std::result::Result<T, Error>;
pub fn error(code: &'static str, message: impl Into<String>, path: &str) -> Error {
    Error {
        code,
        message: message.into(),
        path: path.into(),
        details: json!({}),
    }
}
impl Error {
    pub fn with(mut self, details: Value) -> Self {
        self.details = details;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Versions {
    pub build: String,
    pub marketing: String,
}
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Selection {
    pub target: Option<String>,
    pub configuration: Option<String>,
    pub all_targets: bool,
}
impl Selection {
    pub fn explicit(&self) -> bool {
        self.target.is_some() || self.configuration.is_some() || self.all_targets
    }
    pub fn document(&self) -> Value {
        let mut value = json!({});
        if let Some(t) = &self.target {
            value["target"] = json!(t);
        }
        if let Some(c) = &self.configuration {
            value["configuration"] = json!(c);
        }
        if self.all_targets {
            value["allTargets"] = json!(true);
        }
        value
    }
}
#[derive(Debug)]
pub struct Source {
    pub current: Versions,
    pub builds: Vec<Range<usize>>,
    pub marketing: Vec<Range<usize>>,
}
pub fn semantic(value: &str, platform: &str) -> Result<()> {
    if value.split('.').count() == 3 && value.split('.').all(digits) {
        Ok(())
    } else {
        Err(error(
            "VALIDATION_ERROR",
            format!("The {platform} marketing version must follow x.x.x."),
            "marketingVersion",
        ))
    }
}
fn digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}
const SAFE: u64 = 9_007_199_254_740_991;
pub fn positive(s: &str, field: &str) -> Result<u64> {
    if digits(s)
        && let Ok(n) = s.parse::<u64>()
        && (1..=SAFE).contains(&n)
    {
        return Ok(n);
    }
    Err(error(
        "VALIDATION_ERROR",
        "The build version must be a positive integer.",
        field,
    ))
}
pub fn android_code(s: &str, current: Option<&str>, allow: bool) -> Result<u64> {
    let n = positive(s, "versionCode")?;
    if n > 2_100_000_000 {
        return Err(error(
            "VALIDATION_ERROR",
            "Android versionCode must be at most 2100000000.",
            "versionCode",
        ));
    }
    if let Some(c) = current {
        let c = positive(c, "currentVersionCode")?;
        if n < c && !allow {
            return Err(error(
                "VERSION_CONFLICT",
                format!(
                    "Android versionCode cannot decrease from {c} to {n} without --allow-downgrade."
                ),
                "versionCode",
            ));
        }
    }
    Ok(n)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Android,
    Ios,
}
impl Platform {
    pub fn analyze(self, text: &str, path: &str, sel: &Selection) -> Result<Source> {
        match self {
            Self::Android => android::analyze(text, path),
            Self::Ios => ios::analyze(text, path, sel),
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Android => "Android",
            Self::Ios => "iOS",
        }
    }
}
