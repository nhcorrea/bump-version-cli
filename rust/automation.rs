use crate::{
    Platform, Result, SAFE, Selection, Versions, android_code, error,
    host::Host,
    positive, project, semantic,
    transaction::{Plan, commit},
};
use serde_json::{Value, json};

fn bump(value: &str, release: &str) -> String {
    // Marketing version components have no integer-size limit.
    let mut parts: Vec<String> = value
        .split('.')
        .map(|s| {
            let n = s.trim_start_matches('0');
            if n.is_empty() { "0".into() } else { n.into() }
        })
        .collect();
    let i = match release {
        "major" => 0,
        "minor" => 1,
        _ => 2,
    };
    let mut bytes = parts[i].as_bytes().to_vec();
    let mut carry = true;
    for b in bytes.iter_mut().rev() {
        if *b == b'9' {
            *b = b'0';
        } else {
            *b += 1;
            carry = false;
            break;
        }
    }
    if carry {
        bytes.insert(0, b'1');
    }
    parts[i] = String::from_utf8(bytes).unwrap();
    for v in &mut parts[i + 1..] {
        *v = "0".into()
    }
    parts.join(".")
}
fn required<'a>(v: Option<&'a str>, flag: &str) -> Result<&'a str> {
    v.filter(|s| !s.is_empty()).ok_or_else(|| {
        error(
            "VALIDATION_ERROR",
            format!("Missing required option {flag}."),
            flag,
        )
    })
}
fn compare(actual: &str, expected: &str, label: &str, path: &str) -> Result<()> {
    if actual != expected {
        return Err(error(
            "CHECK_MISMATCH",
            format!("Expected {label} {expected}, found {actual}."),
            path,
        )
        .with(json!({"expected":expected,"actual":actual})));
    }
    Ok(())
}
fn state(platform: Platform, v: &Versions) -> Value {
    match platform {
        Platform::Android => {
            json!({"versionName":v.marketing,"versionCode":v.build.parse::<u64>().unwrap()})
        }
        Platform::Ios => json!({"marketingVersion":v.marketing,"buildNumber":v.build}),
    }
}
pub fn run(host: &impl Host, command: &str, flags: &Value, cwd: &str) -> Result<Value> {
    let root = project::root(host, cwd, flags["root"].as_str().unwrap_or("."))?;
    let options = project::config(host, &root, flags)?;
    let s = |key: &str| options[key].as_str();
    let enabled = |key: &str| options[key].as_bool() == Some(true);
    let selection = Selection {
        target: s("iosTarget").map(String::from),
        configuration: s("iosConfiguration").map(String::from),
        all_targets: enabled("allTargets"),
    };
    let platforms: &[Platform] = match s("platform").unwrap_or("all") {
        "all" => &[Platform::Android, Platform::Ios],
        "android" => &[Platform::Android],
        "ios" => &[Platform::Ios],
        _ => {
            return Err(error(
                "VALIDATION_ERROR",
                "--platform must be android, ios or all.",
                "platform",
            ));
        }
    };
    if selection.all_targets && selection.target.is_some() {
        return Err(error(
            "VALIDATION_ERROR",
            "--ios-target and --all-targets cannot be used together.",
            "--ios-target",
        ));
    }
    if selection.explicit() && platforms == [Platform::Android] {
        return Err(error(
            "VALIDATION_ERROR",
            "iOS target/configuration options require --platform ios or all.",
            "--platform",
        ));
    }
    let release = s("release").unwrap_or("");
    if command == "bump" && !matches!(release, "major" | "minor" | "patch") {
        return Err(error(
            "VALIDATION_ERROR",
            "--release must be major, minor or patch.",
            "release",
        ));
    }
    let output = s("outputFile")
        .map(|path| project::output(host, &root, path))
        .transpose()?;
    let mut compared = false;
    let mut plans = Vec::new();
    let mut results = json!({});
    for &p in platforms {
        let path = project::find(host, &root, p, &options)?;
        if let Some(out) = &output
            && (out == &path || host.call("canonical", &[out]).ok().as_ref() == Some(&path))
        {
            return Err(error(
                "VALIDATION_ERROR",
                "--output-file must be distinct from the project file.",
                out,
            ));
        }
        let text = host
            .call("read", &[&path])
            .map_err(|e| error("PARSE_ERROR", e.to_string(), &path))?;
        let src = p.analyze(&text, &path, &selection)?;
        let current = &src.current;
        let (market, build, market_flag, build_flag, market_label, build_label) = match p {
            Platform::Android => (
                "versionName",
                "versionCode",
                "--version-name or --app-version",
                "--version-code",
                "Android versionName",
                "Android versionCode",
            ),
            Platform::Ios => (
                "marketingVersion",
                "buildNumber",
                "--marketing-version or --app-version",
                "--build-number",
                "iOS marketing version",
                "iOS build number",
            ),
        };
        let marketing = s(market).or(s("appVersion"));
        let build_option = s(build);
        let mut desired = current.clone();
        match command {
            "set" => {
                desired.marketing = required(marketing, market_flag)?.into();
                desired.build = required(build_option, build_flag)?.into();
            }
            "bump" => {
                desired.marketing = bump(&current.marketing, release);
                if let Some(n) = build_option {
                    desired.build = n.into()
                } else if enabled("incrementBuild") {
                    let field = if p == Platform::Ios {
                        "CURRENT_PROJECT_VERSION"
                    } else {
                        build
                    };
                    let n = positive(&current.build, field)?;
                    if n == SAFE {
                        return Err(error(
                            "VERSION_CONFLICT",
                            format!("Cannot increment {field} beyond the safe integer range."),
                            field,
                        ));
                    }
                    desired.build = (n + 1).to_string();
                }
            }
            "check" => {
                if let Some(v) = marketing {
                    compared = true;
                    semantic(v, p.name())?;
                    compare(&current.marketing, v, market_label, &path)?
                }
                if let Some(v) = build_option {
                    compared = true;
                    let normalized = match p {
                        Platform::Android => android_code(v, None, false)?,
                        Platform::Ios => positive(v, build)?,
                    };
                    compare(&current.build, &normalized.to_string(), build_label, &path)?;
                }
            }
            "inspect" => {}
            _ => return Err(error("VALIDATION_ERROR", "Unknown command.", "arguments")),
        }
        let plan = Plan::new(
            p,
            path,
            selection.clone(),
            text,
            src,
            desired,
            enabled("allowDowngrade"),
        )?;
        let mut result = json!({"path":project::relative(host,&root,&plan.path)?,"before":state(p,&plan.original),"after":state(p,&plan.requested),"matches":plan.matches(),"changed":plan.changed()});
        if p == Platform::Ios && selection.explicit() {
            result["selection"] = selection.document();
        }
        results[if p == Platform::Android {
            "android"
        } else {
            "ios"
        }] = result;
        plans.push(plan);
    }
    if command == "check" && !compared {
        return Err(error(
            "VALIDATION_ERROR",
            "check requires at least one expected version option.",
            "check",
        ));
    }
    if command == "bump"
        && let [a, i] = plans.as_slice()
        && a.original.marketing != i.original.marketing
    {
        return Err(error("VERSION_CONFLICT","Android and iOS marketing versions differ; synchronize or bump one platform explicitly.",&root).with(json!({"android":a.original.marketing,"ios":i.original.marketing})));
    }
    if matches!(command, "bump" | "set") && !enabled("dryRun") {
        commit(host, &plans)?;
    }
    Ok(
        json!({"command":command,"changed":plans.iter().any(Plan::changed),"dryRun":enabled("dryRun"),"root":root,"platforms":results,"warnings":[]}),
    )
}

/// Interactive commands retain their fixed legacy paths and bypass automation
/// configuration. The parser, validation and transaction match canonical set.
pub fn legacy(host: &impl Host, req: &Value) -> Result<Value> {
    let cwd = req["cwd"].as_str().unwrap_or(".");
    let root = project::root(host, cwd, ".")?;
    let platform = if req["platform"] == "android" {
        Platform::Android
    } else {
        Platform::Ios
    };
    let selector = match platform {
        Platform::Android => json!({"androidFile":"android/app/build.gradle"}),
        Platform::Ios => {
            json!({"iosProject":format!("ios/{}.xcodeproj/project.pbxproj",req["name"].as_str().unwrap_or(""))})
        }
    };
    let path = project::find(host, &root, platform, &selector)?;
    let text = host
        .call("read", &[&path])
        .map_err(|e| error("PARSE_ERROR", e.to_string(), &path))?;
    let selection = Selection::default();
    let source = platform.analyze(&text, &path, &selection)?;
    if req.get("marketing").is_none() {
        return Ok(json!(source.current));
    }
    let desired = Versions {
        build: req["build"].as_str().unwrap_or("").into(),
        marketing: req["marketing"].as_str().unwrap_or("").into(),
    };
    let plan = Plan::new(
        platform,
        path,
        selection,
        text,
        source,
        desired,
        req["allowDowngrade"] == true,
    )?;
    let result = json!({"platform":platform,"path":plan.path,"before":plan.original,"after":plan.requested,"matches":plan.matches(),"changed":plan.changed()});
    if req["dryRun"] != true {
        commit(host, &[plan])?;
    }
    Ok(result)
}
