use crate::{
    Platform, Result, Selection, Source, Versions, android_code, error, host::Host, positive,
    semantic,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[derive(Debug)]
pub struct Plan {
    pub platform: Platform,
    pub path: String,
    pub selection: Selection,
    pub before: String,
    pub after: String,
    pub original: Versions,
    pub requested: Versions,
    pub builds: usize,
    pub marketing: usize,
}
impl Plan {
    pub fn new(
        platform: Platform,
        path: String,
        selection: Selection,
        text: String,
        source: Source,
        mut requested: Versions,
        allow: bool,
    ) -> Result<Self> {
        requested.build = match platform {
            Platform::Android => {
                android_code(&requested.build, Some(&source.current.build), allow)?
            }
            Platform::Ios => positive(&requested.build, "CURRENT_PROJECT_VERSION")?,
        }
        .to_string();
        semantic(&requested.marketing, platform.name())?;
        let builds = source.builds.len();
        let marketing = source.marketing.len();
        let mut edits: Vec<_> = source
            .builds
            .into_iter()
            .map(|r| (r, &requested.build))
            .chain(
                source
                    .marketing
                    .into_iter()
                    .map(|r| (r, &requested.marketing)),
            )
            .collect();
        edits.sort_unstable_by_key(|(r, _)| r.start);
        let mut after = String::with_capacity(text.len());
        let mut end = 0;
        for (span, value) in edits {
            after.push_str(&text[end..span.start]);
            after.push_str(value);
            end = span.end;
        }
        after.push_str(&text[end..]);
        if after != text && platform.analyze(&after, &path, &selection)?.current != requested {
            return Err(error(
                "VERIFY_ERROR",
                "Transformed values differ from the plan.",
                &path,
            ));
        }
        Ok(Self {
            platform,
            path,
            selection,
            before: text,
            after,
            original: source.current,
            requested,
            builds,
            marketing,
        })
    }
    pub fn changed(&self) -> bool {
        self.before != self.after
    }
    pub fn matches(&self) -> Value {
        json!({"build":self.builds,"marketing":self.marketing,"total":self.builds+self.marketing})
    }
    pub fn hashes(&self) -> (String, String) {
        (
            format!("{:x}", Sha256::digest(&self.before)),
            format!("{:x}", Sha256::digest(&self.after)),
        )
    }
}
fn current(host: &impl Host, path: &str, expected: &str) -> Result<()> {
    let current = host
        .call("read", &[path])
        .map_err(|e| error("WRITE_ERROR", e.to_string(), path))?;
    if current != expected {
        return Err(error(
            "CONCURRENT_MODIFICATION",
            "The target changed after the plan was created; create a new plan and retry.",
            path,
        ));
    }
    Ok(())
}
fn replace(host: &impl Host, path: &str, expected: &str, new: &str) -> Result<()> {
    let fail = |e: std::io::Error| error("WRITE_ERROR", e.to_string(), path);
    if host.call("kind", &[path]).map_err(fail)? != "file"
        || host.call("canonical", &[path]).map_err(fail)? != path
    {
        return Err(error(
            "WRITE_ERROR",
            "Could not inspect target permissions before commit.",
            path,
        ));
    }
    let tmp = host.call("stage", &[path, new]).map_err(fail)?;
    // Stage beside the destination, then check the snapshot again immediately
    // before the atomic rename. Never undo an unrelated edit during rollback.
    let result = current(host, path, expected)
        .and_then(|()| host.call("rename", &[&tmp, path]).map(|_| ()).map_err(fail));
    if let Err(e) = result {
        host.call("remove", &[&tmp]).map_err(fail)?;
        return Err(e);
    }
    Ok(())
}
pub fn commit(host: &impl Host, plans: &[Plan]) -> Result<()> {
    for p in plans {
        current(host, &p.path, &p.before)?;
    }
    let mut applied = Vec::new();
    let result = (|| {
        for p in plans {
            if !p.changed() {
                current(host, &p.path, &p.before)?;
                continue;
            }
            replace(host, &p.path, &p.before, &p.after)?;
            applied.push(p);
            let observed = host
                .call("read", &[&p.path])
                .map_err(|e| error("VERIFY_ERROR", e.to_string(), &p.path))?;
            if observed != p.after
                || p.platform
                    .analyze(&observed, &p.path, &p.selection)?
                    .current
                    != p.requested
            {
                return Err(error(
                    "VERIFY_ERROR",
                    "Committed content failed verification.",
                    &p.path,
                ));
            }
        }
        Ok(())
    })();
    if let Err(cause) = result {
        let mut failed = Vec::new();
        for p in applied.into_iter().rev() {
            if let Err(e) = replace(host, &p.path, &p.after, &p.before)
                .and_then(|()| current(host, &p.path, &p.before))
            {
                failed.push(e);
            }
        }
        if let Some(first) = failed.first() {
            return Err(error(
                "ROLLBACK_ERROR",
                "A multi-file commit failed and one or more applied targets could not be restored.",
                &first.path,
            )
            .with(json!({"commitError":cause,"rollbackErrors":failed})));
        }
        return Err(cause);
    }
    Ok(())
}
