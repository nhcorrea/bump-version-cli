//! Each synchronous Node request owns one Wasm instance. Node writes its input
//! into an exported buffer and copies the result before releasing the instance.
use crate::{
    Result, automation, error,
    host::{Host, System},
    project, semantic,
};
use serde_json::{Value, json};
use std::{cell::RefCell, io};
thread_local! {static INPUT:RefCell<Vec<u8>>=const{RefCell::new(Vec::new())};static OUTPUT:RefCell<Vec<u8>>=const{RefCell::new(Vec::new())};}

#[link(wasm_import_module = "os")]
unsafe extern "C" {
    fn invoke(ptr: *const u8, len: usize) -> usize;
    fn receive(ptr: *mut u8);
}
impl Host for System {
    fn call(&self, op: &str, args: &[&str]) -> io::Result<String> {
        let request = serde_json::to_vec(&(op, args))?;
        // invoke reads the borrowed bytes synchronously. receive writes exactly
        // the size just returned. No user pointer crosses this interface.
        let len = unsafe { invoke(request.as_ptr(), request.len()) };
        let mut bytes = vec![0; len];
        unsafe { receive(bytes.as_mut_ptr()) };
        let (ok, value): (bool, String) = serde_json::from_slice(&bytes)?;
        if ok {
            Ok(value)
        } else {
            Err(io::Error::other(value))
        }
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn input(len: usize) -> *mut u8 {
    INPUT.with_borrow_mut(|buf| {
        buf.resize(len, 0);
        buf.as_mut_ptr()
    })
}
fn request(bytes: &[u8]) -> Result<Value> {
    let req: Value = serde_json::from_slice(bytes)
        .map_err(|e| error("VALIDATION_ERROR", e.to_string(), "arguments"))?;
    let field = |k: &str| req[k].as_str().unwrap_or("");
    match field("operation") {
        "run" => automation::run(&System, field("command"), &req["options"], field("cwd")),
        "semantic" => {
            semantic(field("value"), field("platform"))?;
            Ok(Value::Null)
        }
        "output" | "writeOutput" => {
            let root = project::root(&System, field("cwd"), req["root"].as_str().unwrap_or("."))?;
            if field("operation") == "output" {
                Ok(json!(project::output(&System, &root, field("path"))?))
            } else {
                project::write_output(&System, &root, field("path"), field("document"))?;
                Ok(Value::Null)
            }
        }
        _ => Err(error("VALIDATION_ERROR", "Unknown request.", "arguments")),
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn run() -> usize {
    let result = INPUT.with_borrow(|v| match request(v) {
        Ok(v) => json!({"ok":true,"value":v}),
        Err(e) => json!({"ok":false,"error":e}),
    });
    OUTPUT.with_borrow_mut(|buf| {
        *buf = serde_json::to_vec(&result).expect("serializable result");
        buf.len()
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn output() -> *const u8 {
    OUTPUT.with_borrow(|buf| buf.as_ptr())
}
