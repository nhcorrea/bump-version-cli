use crate::syntax::{Lexed, braces, closing, pattern};
use crate::{Result, Source, Versions, android_code, digits, error, semantic};
use serde_json::{Value, json};
use std::ops::Range;

struct Occurrence<'a> {
    field: &'a str,
    expr: &'a str,
    line: usize,
    inside: bool,
    value: Option<Range<usize>>,
}
impl Occurrence<'_> {
    fn detail(&self) -> Value {
        json!({"field":self.field,"expression":self.expr,"line":self.line,"scope":if self.inside{"defaultConfig"}else{"override"}})
    }
}
fn direct(line: &str, field: &str, start: usize, kotlin: bool) -> Option<Range<usize>> {
    let tail = line.strip_prefix(field)?;
    let rhs = if let Some(value) = tail.trim_start().strip_prefix('=') {
        value.trim_start()
    } else {
        if kotlin || !tail.starts_with([' ', '\t']) {
            return None;
        }
        tail.trim_start()
    };
    let rhs = rhs.trim_end();
    let rhs = rhs.strip_suffix(';').unwrap_or(rhs).trim_end();
    let value = if field == "versionCode" {
        if !digits(rhs) {
            return None;
        }
        rhs
    } else {
        let q = rhs.chars().next()?;
        if q != '"' && (kotlin || q != '\'') {
            return None;
        }
        rhs.strip_prefix(q)?.strip_suffix(q)?
    };
    let offset = start + value.as_ptr() as usize - line.as_ptr() as usize;
    Some(offset..offset + value.len())
}
pub fn analyze(text: &str, path: &str) -> Result<Source> {
    let lex = Lexed::new(text, true);
    let starts: Vec<_> = pattern!(r"(?m)^[ \t]*defaultConfig[ \t]*\{")
        .find_iter(&lex.structure)
        .collect();
    let open = match starts.as_slice() {
        [] => {
            return Err(error(
                "PARSE_ERROR",
                "Could not find a supported defaultConfig block.",
                path,
            ));
        }
        [m] => m.end() - 1,
        _ => {
            return Err(error(
                "AMBIGUOUS",
                "Multiple defaultConfig blocks were found.",
                path,
            )
            .with(json!({"matches":starts.len()})));
        }
    };
    let close = closing(
        &braces(&lex.structure),
        open,
        "The defaultConfig block is not balanced.",
        path,
    )?;
    let kotlin = path.ends_with(".kts");
    let mut occurrences = Vec::new();
    let mut offset = 0;
    for (n, line) in lex.comments.split_inclusive('\n').enumerate() {
        let expr = line.trim();
        let start = offset + line.len() - line.trim_start().len();
        offset += line.len();
        for field in ["versionCode", "versionName"] {
            if !expr.starts_with(field) || !lex.structure[start..].starts_with(field) {
                continue;
            }
            if expr
                .as_bytes()
                .get(field.len())
                .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
            {
                continue;
            }
            occurrences.push(Occurrence {
                field,
                expr,
                line: n + 1,
                inside: open < start && start < close,
                value: direct(expr, field, start, kotlin),
            });
        }
    }
    let outside: Vec<_> = occurrences
        .iter()
        .filter(|o| !o.inside)
        .map(Occurrence::detail)
        .collect();
    if !outside.is_empty() {
        return Err(error(
            "AMBIGUOUS",
            "Android version overrides outside defaultConfig require an explicit source policy.",
            path,
        )
        .with(json!({"candidates":outside})));
    }
    let find = |field: &str| -> Result<Range<usize>> {
        let matches: Vec<_> = occurrences.iter().filter(|o| o.field == field).collect();
        let details =
            || json!({"candidates":matches.iter().map(|m|m.detail()).collect::<Vec<_>>()});
        match matches.as_slice() {
            [] => Err(error(
                "PARSE_ERROR",
                format!("Could not find {field} inside defaultConfig."),
                path,
            )),
            [m] => m.value.clone().ok_or_else(|| {
                error(
                    "PARSE_ERROR",
                    format!(
                        "{field} must be a direct {} literal assignment.",
                        if kotlin { "kotlin" } else { "groovy" }
                    ),
                    path,
                )
                .with(details())
            }),
            _ => Err(error(
                "AMBIGUOUS",
                format!("Multiple {field} assignments were found inside defaultConfig."),
                path,
            )
            .with(details())),
        }
    };
    let build = find("versionCode")?;
    let marketing = find("versionName")?;
    if android_code(&text[build.clone()], None, false).is_err()
        || semantic(&text[marketing.clone()], "Android").is_err()
    {
        return Err(error(
            "PARSE_ERROR",
            "Android defaultConfig contains an unsupported version literal.",
            path,
        ));
    }
    Ok(Source {
        current: Versions {
            build: text[build.clone()].into(),
            marketing: text[marketing.clone()].into(),
        },
        builds: vec![build],
        marketing: vec![marketing],
    })
}
