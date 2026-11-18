use crate::{Result, error};
use std::collections::BTreeMap;

// Replace one byte with one byte. All offsets remain UTF-8 byte offsets into
// the original file, even when comments and literals contain non-ASCII text.
pub struct Lexed {
    pub comments: String,
    pub structure: String,
}
impl Lexed {
    pub fn new(text: &str, gradle: bool) -> Self {
        let bytes = text.as_bytes();
        let mut comments = bytes.to_vec();
        let mut structure = bytes.to_vec();
        let mut i = 0;
        while i < bytes.len() {
            let start = i;
            let rest = &bytes[i..];
            let comment = rest.starts_with(b"//") || rest.starts_with(b"/*");
            if rest.starts_with(b"//") {
                i += rest.iter().position(|b| *b == b'\n').unwrap_or(rest.len());
            } else if rest.starts_with(b"/*") {
                i += 2;
                i += bytes[i..]
                    .windows(2)
                    .position(|w| w == b"*/")
                    .map(|p| p + 2)
                    .unwrap_or(bytes.len() - i);
            } else if bytes[i] == b'"' || gradle && bytes[i] == b'\'' {
                let quote = bytes[i];
                let width = if gradle && rest.starts_with(&[quote; 3]) {
                    3
                } else {
                    1
                };
                i += width;
                while i < bytes.len() {
                    if bytes[i..].starts_with(&rest[..width]) {
                        i += width;
                        break;
                    }
                    if width == 1 && bytes[i] == b'\\' {
                        i = (i + 2).min(bytes.len())
                    } else {
                        i += 1
                    }
                }
            } else {
                i += 1;
                continue;
            }
            for p in start..i {
                if !matches!(bytes[p], b'\r' | b'\n') {
                    structure[p] = b' ';
                    if comment {
                        comments[p] = b' ';
                    }
                }
            }
        }
        Self {
            comments: String::from_utf8(comments).unwrap(),
            structure: String::from_utf8(structure).unwrap(),
        }
    }
}
// Match all braces once, including nested objects in large Xcode projects.
pub fn braces(text: &str) -> BTreeMap<usize, usize> {
    let mut stack = Vec::new();
    let mut pairs = BTreeMap::new();
    for (i, b) in text.bytes().enumerate() {
        match b {
            b'{' => stack.push(i),
            b'}' => {
                if let Some(open) = stack.pop() {
                    pairs.insert(open, i);
                }
            }
            _ => {}
        }
    }
    pairs
}
pub fn closing(
    pairs: &BTreeMap<usize, usize>,
    open: usize,
    message: &str,
    path: &str,
) -> Result<usize> {
    pairs
        .get(&open)
        .copied()
        .ok_or_else(|| error("PARSE_ERROR", message, path))
}

macro_rules! pattern {
    ($expr:literal) => {{
        static PATTERN: std::sync::LazyLock<regex_lite::Regex> = std::sync::LazyLock::new(|| {
            regex_lite::Regex::new($expr).expect("valid parser pattern")
        });
        &*PATTERN
    }};
}
pub(crate) use pattern;
