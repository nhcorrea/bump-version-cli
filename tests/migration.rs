use bump_version::{
    Platform, Selection, Versions, android_code, automation,
    host::{Host, System},
    transaction::{Plan, commit},
};
use serde_json::json;
use std::{
    cell::Cell,
    fs, io,
    path::{Path, PathBuf},
};
use tempfile::TempDir;

const ANDROID: &str = include_str!("../test/fixtures/android-groovy/android/app/build.gradle");
const IOS: &str = include_str!("../test/fixtures/ios-basic/ios/Audit.xcodeproj/project.pbxproj");
const GRAPH: &str =
    include_str!("../test/fixtures/ios-targets/ios/Targets.xcodeproj/project.pbxproj");

fn setup() -> (TempDir, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(temp.path()).unwrap();
    let a = root.join("android/app/build.gradle");
    let i = root.join("ios/Audit.xcodeproj/project.pbxproj");
    for (p, data) in [(&a, ANDROID), (&i, IOS)] {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, data).unwrap();
    }
    (temp, a, i)
}
fn plan(
    p: Platform,
    path: &Path,
    build: &str,
    marketing: &str,
    allow: bool,
) -> bump_version::Result<Plan> {
    let text = fs::read_to_string(path).unwrap();
    let path = path.to_str().unwrap();
    let selection = Selection::default();
    let src = p.analyze(&text, path, &selection)?;
    Plan::new(
        p,
        path.into(),
        selection,
        text,
        src,
        Versions {
            build: build.into(),
            marketing: marketing.into(),
        },
        allow,
    )
}
fn clean(path: &Path) {
    assert!(fs::read_dir(path.parent().unwrap()).unwrap().all(|e| {
        !e.unwrap()
            .file_name()
            .to_string_lossy()
            .contains(".bump-version-")
    }));
}
#[test]
fn validates_normalizes_and_checks_downgrade() {
    assert_eq!(android_code("00042", Some("41"), false).unwrap(), 42);
    for n in [1, 2_100_000_000] {
        assert_eq!(android_code(&n.to_string(), None, false).unwrap(), n);
    }
    for invalid in ["0", "-1", "1.5", "1e3", "2100000001"] {
        assert_eq!(
            android_code(invalid, None, false).unwrap_err().code,
            "VALIDATION_ERROR"
        );
    }
    let e = android_code("40", Some("41"), false).unwrap_err();
    assert_eq!(e.code, "VERSION_CONFLICT");
    assert_eq!(e.path, "versionCode");
    assert!(e.message.contains("--allow-downgrade"));
    assert_eq!(android_code("40", Some("41"), true).unwrap(), 40);
}
#[test]
fn virtual_android_path_and_exact_replacements() {
    let p = "/virtual/app/build.gradle";
    let text = include_str!("../test/fixtures/android-equals/android/app/build.gradle");
    let make = |allow| {
        Plan::new(
            Platform::Android,
            p.into(),
            Selection::default(),
            text.into(),
            Platform::Android.analyze(text, p, &Selection::default())?,
            Versions {
                build: "40".into(),
                marketing: "1.2.4".into(),
            },
            allow,
        )
    };
    assert_eq!(make(false).unwrap_err().code, "VERSION_CONFLICT");
    let plan = make(true).unwrap();
    assert_eq!(
        plan.original,
        Versions {
            build: "41".into(),
            marketing: "1.2.3".into()
        }
    );
    assert_eq!(
        plan.after,
        text.replace("41", "40").replace("1.2.3", "1.2.4")
    );
}
#[test]
fn ios_crlf_comments_and_selected_graph_ranges() {
    let text = GRAPH
        .replace("CURRENT_PROJECT_VERSION =", "CURRENT_PROJECT_VERSION  =  ")
        .replace('\n', "\r\n");
    let s = Selection {
        target: Some("App".into()),
        configuration: Some("Release".into()),
        ..Default::default()
    };
    assert_eq!(
        Platform::Ios
            .analyze(&text, "p", &Selection::default())
            .unwrap_err()
            .code,
        "AMBIGUOUS"
    );
    let src = Platform::Ios.analyze(&text, "p", &s).unwrap();
    let plan = Plan::new(
        Platform::Ios,
        "p".into(),
        s,
        text.clone(),
        src,
        Versions {
            build: "42".into(),
            marketing: "1.2.4".into(),
        },
        false,
    )
    .unwrap();
    assert_eq!(
        plan.after,
        text.replace("\"41\"", "\"42\"")
            .replace("\"1.2.3\"", "\"1.2.4\"")
    );
}
#[test]
fn hashes_matches_and_noop() {
    let (_t, a, _) = setup();
    let make = || plan(Platform::Android, &a, "42", "1.2.4", false).unwrap();
    let p = make();
    assert_eq!(p.hashes(), make().hashes());
    let (b, c) = p.hashes();
    assert_ne!(b, c);
    for hash in [b, c] {
        assert_eq!(hash.len(), 64);
        assert!(hash.bytes().all(|b| b.is_ascii_hexdigit()));
    }
    assert_eq!(p.matches(), json!({"build":1,"marketing":1,"total":2}));
    assert!(p.changed());
    let same = plan(Platform::Android, &a, "41", "1.2.3", false).unwrap();
    assert!(!same.changed());
    assert_eq!(same.hashes().0, same.hashes().1);
    let before = fs::metadata(&a).unwrap().modified().unwrap();
    commit(&System, &[same]).unwrap();
    assert_eq!(before, fs::metadata(&a).unwrap().modified().unwrap());
    assert_eq!(fs::read_to_string(a).unwrap(), ANDROID);
}
#[test]
fn stale_single_and_multi_preflight_do_not_overwrite() {
    let (_t, a, i) = setup();
    let ap = plan(Platform::Android, &a, "42", "1.2.4", false).unwrap();
    let ip = plan(Platform::Ios, &i, "42", "1.2.4", false).unwrap();
    fs::write(&i, format!("{IOS}// changed")).unwrap();
    assert_eq!(
        commit(&System, &[ap, ip]).unwrap_err().code,
        "CONCURRENT_MODIFICATION"
    );
    assert_eq!(fs::read_to_string(&a).unwrap(), ANDROID);
    let p = plan(Platform::Android, &a, "42", "1.2.4", false).unwrap();
    let changed = format!("{ANDROID}// changed");
    fs::write(&a, &changed).unwrap();
    assert_eq!(
        commit(&System, &[p]).unwrap_err().code,
        "CONCURRENT_MODIFICATION"
    );
    assert_eq!(fs::read_to_string(&a).unwrap(), changed);
    clean(&a);
    clean(&i);
}
#[cfg(unix)]
#[test]
fn preserves_mode_replaces_inode_and_rejects_symlink() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
    let (t, a, _) = setup();
    let link = t.path().join("link.gradle");
    symlink(&a, &link).unwrap();
    let p = plan(Platform::Android, &link, "42", "1.2.4", false).unwrap();
    assert_eq!(commit(&System, &[p]).unwrap_err().code, "WRITE_ERROR");
    assert!(link.is_symlink());
    assert_eq!(fs::read_to_string(&a).unwrap(), ANDROID);
    fs::set_permissions(&a, fs::Permissions::from_mode(0o640)).unwrap();
    let old = fs::metadata(&a).unwrap().ino();
    let p = plan(Platform::Android, &a, "42", "1.2.4", false).unwrap();
    commit(&System, &[p]).unwrap();
    let meta = fs::metadata(&a).unwrap();
    assert_ne!(old, meta.ino());
    assert_eq!(meta.mode() & 0o777, 0o640);
    assert!(fs::read_to_string(&a).unwrap().contains("versionCode 42"));
    clean(&a);
}
struct Fault<'a> {
    second: &'a str,
    renamed_second: Cell<bool>,
    fail_verification: bool,
    fail_restore: bool,
    failed: Cell<bool>,
}
impl Host for Fault<'_> {
    fn call(&self, op: &str, args: &[&str]) -> io::Result<String> {
        if op == "rename" && args[1] == self.second {
            if !self.fail_verification {
                return Err(io::Error::other("second rename denied"));
            }
            self.renamed_second.set(true);
        }
        if op == "read"
            && args[0] == self.second
            && self.renamed_second.get()
            && !self.failed.replace(true)
        {
            return Err(io::Error::other("injected verification read failure"));
        }
        if op == "stage" && self.failed.get() && args[0] != self.second && self.fail_restore {
            return Err(io::Error::other("first restore denied"));
        }
        System.call(op, args)
    }
}
#[test]
fn restores_second_and_first_on_verification_or_commit_failure() {
    for (verify, restore, expected) in [
        (false, false, "WRITE_ERROR"),
        (true, false, "VERIFY_ERROR"),
        (true, true, "ROLLBACK_ERROR"),
    ] {
        let (_t, a, i) = setup();
        let ap = plan(Platform::Android, &a, "42", "1.2.4", false).unwrap();
        let ip = plan(Platform::Ios, &i, "42", "1.2.4", false).unwrap();
        let fault = Fault {
            second: i.to_str().unwrap(),
            renamed_second: Cell::new(false),
            fail_verification: verify,
            fail_restore: restore,
            failed: Cell::new(false),
        };
        assert_eq!(commit(&fault, &[ap, ip]).unwrap_err().code, expected);
        assert_eq!(fs::read_to_string(&i).unwrap(), IOS);
        let actual = fs::read_to_string(&a).unwrap();
        if restore {
            assert!(actual.contains("versionCode 42"));
        } else {
            assert_eq!(actual, ANDROID);
        }
        clean(&a);
        clean(&i);
    }
}
#[cfg(unix)]
#[test]
fn confines_input_and_output_symlinks_before_writes() {
    use bump_version::project;
    use std::os::unix::fs::symlink;
    let (t, a, _) = setup();
    let outside = tempfile::tempdir().unwrap();
    let external = outside.path().join("gradle");
    fs::write(&external, ANDROID).unwrap();
    symlink(&external, t.path().join("link")).unwrap();
    symlink(outside.path(), t.path().join("escape")).unwrap();
    let cwd = t.path().to_str().unwrap();
    for opts in [
        json!({"androidFile":"link"}),
        json!({"outputFile":"escape/result.json"}),
        json!({"outputFile":"link"}),
        json!({"outputFile":"android/app/build.gradle"}),
    ] {
        let mut options = json!({"platform":"android","appVersion":"1.2.4","versionCode":"42"});
        options
            .as_object_mut()
            .unwrap()
            .extend(opts.as_object().unwrap().clone());
        assert_eq!(
            automation::run(&System, "set", &options, cwd)
                .unwrap_err()
                .code,
            "VALIDATION_ERROR"
        );
        assert_eq!(fs::read_to_string(&a).unwrap(), ANDROID);
    }
    assert!(project::output(&System, cwd, "../outside").is_err());
    assert_eq!(fs::read_to_string(external).unwrap(), ANDROID);
}
#[test]
fn dry_run_matches_real_multi_platform_commit_and_rejects_invalid_config() {
    let (t, a, i) = setup();
    let cwd = t.path().to_str().unwrap();
    let mut opts =
        json!({"appVersion":"1.2.4","versionCode":"00042","buildNumber":"42","dryRun":true});
    shared_config(t.path(), r#"{"schemaVersion":1,"unexpected":true}"#);
    assert_eq!(
        automation::run(&System, "set", &opts, cwd)
            .unwrap_err()
            .code,
        "PARSE_ERROR"
    );
    shared_config(
        t.path(),
        r#"{"android":{"versionName":"1.3.0","versionCode":4}}"#,
    );
    let dry = automation::run(&System, "set", &opts, cwd).unwrap();
    assert_eq!(fs::read_to_string(&a).unwrap(), ANDROID);
    assert_eq!(fs::read_to_string(&i).unwrap(), IOS);
    opts["dryRun"] = json!(false);
    let applied = automation::run(&System, "set", &opts, cwd).unwrap();
    assert_eq!(dry["platforms"], applied["platforms"]);
    assert_eq!(
        applied["platforms"]["android"]["after"],
        json!({"versionName":"1.3.0","versionCode":42})
    );
}
fn shared_config(root: &Path, source: &str) {
    fs::write(root.join(".bump-version.json"), source).unwrap()
}

#[test]
#[cfg(unix)]
fn unwritable_directory_keeps_original_and_cleans_temps() {
    use std::os::unix::fs::PermissionsExt;
    let (_temp, a, _) = setup();
    let plan = plan(Platform::Android, &a, "42", "1.2.4", false).unwrap();
    let dir = a.parent().unwrap();
    let old = fs::metadata(dir).unwrap().permissions();
    fs::set_permissions(dir, fs::Permissions::from_mode(0o500)).unwrap();
    let result = commit(&System, &[plan]);
    fs::set_permissions(dir, old).unwrap();
    assert_eq!(result.unwrap_err().code, "WRITE_ERROR");
    assert_eq!(fs::read_to_string(&a).unwrap(), ANDROID);
    clean(&a);
}

#[test]
fn concurrent_edit_while_staging_survives_and_temporary_is_removed() {
    struct EditAfterStage;
    impl Host for EditAfterStage {
        fn call(&self, op: &str, args: &[&str]) -> io::Result<String> {
            let result = System.call(op, args)?;
            if op == "stage" {
                fs::write(args[0], "concurrent edit")?;
            }
            Ok(result)
        }
    }
    let (_temp, android, _) = setup();
    let p = plan(Platform::Android, &android, "42", "1.2.4", false).unwrap();
    assert_eq!(
        commit(&EditAfterStage, &[p]).unwrap_err().code,
        "CONCURRENT_MODIFICATION"
    );
    assert_eq!(fs::read_to_string(&android).unwrap(), "concurrent edit");
    clean(&android);
}
