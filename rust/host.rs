//! Small synchronous OS interface. Paths are interpreted by the host OS (also
//! when the Rust library runs inside Node's WebAssembly engine on Windows).
use std::io;

pub trait Host {
    fn call(&self, op: &str, args: &[&str]) -> io::Result<String>;
}
pub struct System;

#[cfg(not(target_arch = "wasm32"))]
impl Host for System {
    fn call(&self, op: &str, args: &[&str]) -> io::Result<String> {
        use std::{fs, io::Write, path::Path};
        let p = Path::new(args[0]);
        match op {
            "absolute" => {
                let mut path = std::path::PathBuf::new();
                for part in std::path::absolute(p.join(args[1]))?.components() {
                    match part {
                        std::path::Component::ParentDir => {
                            path.pop();
                        }
                        std::path::Component::CurDir => {}
                        other => path.push(other.as_os_str()),
                    }
                }
                Ok(path.to_string_lossy().into_owned())
            }
            "canonical" => Ok(fs::canonicalize(p)?.to_string_lossy().into_owned()),
            "relative" => Ok(p
                .strip_prefix(args[1])
                .map(|s| s.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/"))
                .unwrap_or_else(|_| "..".into())),
            "parent" => Ok(p.parent().unwrap_or(p).to_string_lossy().into_owned()),
            "kind" => match fs::symlink_metadata(p) {
                Ok(m) => Ok(if m.is_file() {
                    "file"
                } else if m.is_dir() {
                    "directory"
                } else {
                    "other"
                }
                .into()),
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok("missing".into()),
                Err(e) => Err(e),
            },
            "directories" => {
                let mut names = Vec::new();
                for entry in fs::read_dir(p)? {
                    let e = entry?;
                    if e.file_type()?.is_dir() {
                        names.push(e.file_name().to_string_lossy().into_owned())
                    }
                }
                Ok(serde_json::to_string(&names)?)
            }
            "read" => fs::read_to_string(p),
            "stage" => {
                let mut tmp = tempfile::Builder::new()
                    .prefix(".bump-version-")
                    .tempfile_in(
                        p.parent()
                            .ok_or_else(|| io::Error::other("missing parent"))?,
                    )?;
                tmp.write_all(args[1].as_bytes())?;
                if let Ok(meta) = fs::symlink_metadata(p) {
                    if !meta.is_file() {
                        return Err(io::Error::other("expected regular file"));
                    }
                    tmp.as_file().set_permissions(meta.permissions())?;
                }
                let (_, name) = tmp.keep()?;
                Ok(name.to_string_lossy().into_owned())
            }
            "rename" => {
                fs::rename(p, args[1])?;
                Ok(String::new())
            }
            "remove" => {
                fs::remove_file(p)?;
                Ok(String::new())
            }
            _ => Err(io::Error::other("unknown OS operation")),
        }
    }
}
