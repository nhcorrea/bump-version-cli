use crate::{Platform, Result, error, host::Host};
use serde_json::{Value, json};

fn io(
    host: &impl Host,
    op: &str,
    args: &[&str],
    code: &'static str,
    message: &str,
) -> Result<String> {
    host.call(op, args)
        .map_err(|_| error(code, message, args[0]))
}
pub fn root(host: &impl Host, cwd: &str, option: &str) -> Result<String> {
    let path = host
        .call("absolute", &[cwd, option])
        .map_err(|e| error("NOT_FOUND", e.to_string(), cwd))?;
    let real = io(
        host,
        "canonical",
        &[&path],
        "NOT_FOUND",
        "Could not resolve the project root.",
    )?;
    if host.call("kind", &[&real]).as_deref().ok() != Some("directory") {
        return Err(error(
            "NOT_FOUND",
            "Could not resolve the project root.",
            &path,
        ));
    }
    Ok(real)
}
pub fn relative(host: &impl Host, root: &str, path: &str) -> Result<String> {
    let rel = host
        .call("relative", &[path, root])
        .map_err(|e| error("VALIDATION_ERROR", e.to_string(), path))?;
    if rel == ".." || rel.starts_with("../") {
        return Err(error(
            "VALIDATION_ERROR",
            "The selected file must be inside the project root.",
            path,
        ));
    }
    Ok(rel)
}
fn absolute(host: &impl Host, root: &str, path: &str) -> Result<String> {
    let p = host
        .call("absolute", &[root, path])
        .map_err(|e| error("VALIDATION_ERROR", e.to_string(), path))?;
    relative(host, root, &p)?;
    Ok(p)
}
fn file(host: &impl Host, root: &str, path: &str) -> Result<String> {
    let p = absolute(host, root, path)?;
    let real = io(
        host,
        "canonical",
        &[&p],
        "NOT_FOUND",
        "Could not find the selected project file.",
    )?;
    relative(host, root, &real)?;
    if host.call("kind", &[&real]).as_deref().ok() != Some("file") {
        return Err(error(
            "NOT_FOUND",
            "The selected path is not a regular file.",
            &real,
        ));
    }
    Ok(real)
}
pub fn output(host: &impl Host, root: &str, path: &str) -> Result<String> {
    let p = absolute(host, root, path)?;
    let parent = host
        .call("parent", &[&p])
        .map_err(|e| error("NOT_FOUND", e.to_string(), &p))?;
    let real = io(
        host,
        "canonical",
        &[&parent],
        "NOT_FOUND",
        "The --output-file parent directory does not exist.",
    )?;
    relative(host, root, &real)?;
    if host.call("kind", &[&real]).as_deref().ok() != Some("directory") {
        return Err(error(
            "NOT_FOUND",
            "The --output-file parent is not a directory.",
            &parent,
        ));
    }
    let kind = host
        .call("kind", &[&p])
        .map_err(|e| error("WRITE_ERROR", e.to_string(), &p))?;
    if kind != "missing" && kind != "file" {
        return Err(error(
            "VALIDATION_ERROR",
            "--output-file must target a regular file.",
            &p,
        ));
    }
    Ok(p)
}
/// Validate an existing report destination before enabling even the error-report
/// path. Otherwise failure on Android could overwrite a still-unread iOS file.
pub fn report_path(host: &impl Host, root: &str, path: &str, flags: &Value) -> Result<String> {
    let out = output(host, root, path)?;
    let config_name = flags["config"].as_str().unwrap_or(".bump-version.json");
    let config_path = absolute(host, root, config_name)?;
    let real = host
        .call("canonical", &[&out])
        .unwrap_or_else(|_| out.clone());
    if out == config_path || host.call("canonical", &[&config_path]).ok().as_ref() == Some(&real) {
        return Err(error(
            "VALIDATION_ERROR",
            "--output-file must be distinct from the configuration file.",
            &out,
        ));
    }
    if host.call("kind", &[&out]).as_deref().ok() == Some("file") {
        let options = config(host, root, flags)?;
        for p in [Platform::Android, Platform::Ios] {
            if find(host, root, p, &options).ok().as_ref() == Some(&real) {
                return Err(error(
                    "VALIDATION_ERROR",
                    "--output-file must be distinct from the project file.",
                    &out,
                ));
            }
        }
    }
    Ok(out)
}
pub fn write_output(host: &impl Host, root: &str, path: &str, document: &str) -> Result<()> {
    let p = output(host, root, path)?;
    let fail = |e: std::io::Error| error("WRITE_ERROR", e.to_string(), &p);
    let staged = host.call("stage", &[&p, document]).map_err(fail)?;
    if let Err(e) = host.call("rename", &[&staged, &p]) {
        host.call("remove", &[&staged]).map_err(fail)?;
        return Err(fail(e));
    }
    Ok(())
}
pub fn config(host: &impl Host, root: &str, flags: &Value) -> Result<Value> {
    let path = flags["config"].as_str().unwrap_or(".bump-version.json");
    let p = absolute(host, root, path)?;
    let mut opts = json!({});
    if flags.get("config").is_some() || host.call("kind", &[&p]).as_deref().ok() != Some("missing")
    {
        let p = file(host, root, path)?;
        let text = io(
            host,
            "read",
            &[&p],
            "PARSE_ERROR",
            "Could not parse the automation configuration as JSON.",
        )?;
        let doc: Value = serde_json::from_str(&text).map_err(|_| {
            error(
                "PARSE_ERROR",
                "Could not parse the automation configuration as JSON.",
                &p,
            )
        })?;
        for (label, keys) in [
            (
                "Configuration",
                &["schemaVersion", "platform", "appVersion", "android", "ios"][..],
            ),
            ("android", &["file", "module", "versionName", "versionCode"]),
            (
                "ios",
                &[
                    "project",
                    "target",
                    "configuration",
                    "allTargets",
                    "marketingVersion",
                    "buildNumber",
                ],
            ),
        ] {
            let value = if label == "Configuration" {
                &doc
            } else if let Some(v) = doc.get(label) {
                v
            } else {
                continue;
            };
            let obj = value.as_object().ok_or_else(|| {
                error("PARSE_ERROR", format!("{label} must be a JSON object."), &p)
            })?;
            let unknown: Vec<_> = obj
                .keys()
                .filter(|k| !keys.contains(&k.as_str()))
                .cloned()
                .collect();
            if !unknown.is_empty() {
                return Err(error(
                    "PARSE_ERROR",
                    format!("{label} contains unknown keys: {}.", unknown.join(", ")),
                    &p,
                ));
            }
            for (key, value) in obj {
                let field = if label == "Configuration" {
                    key.clone()
                } else {
                    format!("{label}.{key}")
                };
                let fail = |msg: &str| error("PARSE_ERROR", format!("{field} {msg}."), &p);
                let v = match key.as_str() {
                    "schemaVersion" => {
                        if value.as_f64() != Some(1.0) {
                            return Err(error(
                                "PARSE_ERROR",
                                "Configuration schemaVersion must be 1.",
                                &p,
                            ));
                        }
                        continue;
                    }
                    "android" | "ios" => continue,
                    "allTargets" => {
                        json!(value.as_bool().ok_or_else(|| fail("must be a boolean"))?)
                    }
                    "versionCode" | "buildNumber" => {
                        if let Some(s) = value.as_str() {
                            json!(s)
                        } else if let Some(n) = value.as_f64()
                            && n.fract() == 0.0
                            && n.abs() <= crate::SAFE as f64
                        {
                            json!((n as i64).to_string())
                        } else {
                            return Err(fail("must be an integer or an integer string"));
                        }
                    }
                    _ => json!(
                        value
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .ok_or_else(|| fail("must be a non-empty string"))?
                    ),
                };
                if key == "platform" && !matches!(v.as_str(), Some("android" | "ios" | "all")) {
                    return Err(error(
                        "PARSE_ERROR",
                        "Configuration platform must be android, ios or all.",
                        &p,
                    ));
                }
                let name = match key.as_str() {
                    "file" => "androidFile",
                    "module" => "androidModule",
                    "project" => "iosProject",
                    "target" => "iosTarget",
                    "configuration" => "iosConfiguration",
                    other => other,
                };
                opts[name] = v;
            }
        }
    }
    if let Some(obj) = flags.as_object() {
        for (k, v) in obj {
            opts[k] = v.clone();
        }
    }
    Ok(opts)
}
pub fn find(host: &impl Host, root: &str, platform: Platform, opts: &Value) -> Result<String> {
    if platform == Platform::Android {
        if let Some(p) = opts["androidFile"].as_str() {
            return file(host, root, p);
        }
        let module = opts["androidModule"].as_str().unwrap_or("app");
        for name in ["build.gradle.kts", "build.gradle"] {
            let candidate = absolute(host, root, &format!("android/{module}/{name}"))?;
            if host.call("kind", &[&candidate]).as_deref().ok() != Some("missing") {
                return file(host, root, &candidate);
            }
        }
        return Err(error(
            "NOT_FOUND",
            format!("Could not find build.gradle.kts or build.gradle for Android module {module}."),
            &absolute(host, root, &format!("android/{module}"))?,
        ));
    }
    if let Some(p) = opts["iosProject"].as_str() {
        let candidate = if p.ends_with("project.pbxproj") {
            p.into()
        } else if p.ends_with(".xcodeproj") {
            format!(
                "{}{p}/project.pbxproj",
                if p.contains(['/', '\\']) { "" } else { "ios/" }
            )
        } else if p.contains(['/', '\\']) {
            p.into()
        } else {
            format!("ios/{p}.xcodeproj/project.pbxproj")
        };
        return file(host, root, &candidate);
    }
    let dir = absolute(host, root, "ios")?;
    let real = io(
        host,
        "canonical",
        &[&dir],
        "NOT_FOUND",
        "Could not inspect the iOS directory.",
    )?;
    relative(host, root, &real)?;
    let listing = io(
        host,
        "directories",
        &[&real],
        "NOT_FOUND",
        "Could not inspect the iOS directory.",
    )?;
    let mut dirs: Vec<String> =
        serde_json::from_str(&listing).map_err(|e| error("NOT_FOUND", e.to_string(), &dir))?;
    dirs.retain(|n| n.ends_with(".xcodeproj"));
    dirs.sort();
    match dirs.as_slice() {
        [] => Err(error("NOT_FOUND", "No iOS .xcodeproj was found.", &dir)),
        [name] => file(host, root, &format!("ios/{name}/project.pbxproj")),
        _ => Err(error(
            "AMBIGUOUS",
            format!(
                "Multiple iOS projects were found: {}. Use --ios-project.",
                dirs.join(", ")
            ),
            &dir,
        )),
    }
}
