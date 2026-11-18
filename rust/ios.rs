use crate::syntax::{Lexed, braces, closing, pattern};
use crate::{Result, Selection, Source, Versions, digits, error, positive, semantic};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;

#[derive(Default)]
struct Block {
    open: usize,
    close: usize,
    id: String,
    name: String,
    targets: Vec<String>,
    base: bool,
}
impl Block {
    fn metadata(&self) -> Value {
        let mut data = json!({});
        if !self.id.is_empty() {
            data["configurationId"] = json!(self.id);
        }
        if !self.name.is_empty() {
            data["configuration"] = json!(self.name);
        }
        if !self.targets.is_empty() {
            data["targets"] = json!(self.targets);
        }
        data
    }
}
#[derive(Default)]
struct Object {
    id: String,
    isa: String,
    name: String,
    list: String,
    ids: Vec<String>,
    block: Option<usize>,
    base: bool,
}
struct Graph {
    configs: BTreeMap<String, Object>,
    targets: Vec<Object>,
}
fn decode(value: &str) -> String {
    serde_json::from_str::<String>(value).unwrap_or_else(|_| value.trim_matches('"').into())
}
fn graph(
    lex: &Lexed,
    pairs: &BTreeMap<usize, usize>,
    blocks: &mut [Block],
    path: &str,
) -> Result<Graph> {
    let mut targets = Vec::new();
    let mut configs = BTreeMap::new();
    let mut lists = BTreeMap::new();
    for cap in
        pattern!(r"(?m)^[ \t]*([A-Za-z0-9]{4,32})[ \t]*=[ \t]*\{").captures_iter(&lex.structure)
    {
        let open = cap.get(0).unwrap().end() - 1;
        let end = closing(pairs, open, "An iOS object block is not balanced.", path)?;
        let mut direct = String::new();
        let mut structural = String::new();
        let mut start = open + 1;
        while let Some(nested) = lex.structure[start..end].find('{') {
            let pos = start + nested;
            direct.push_str(&lex.comments[start..pos]);
            direct.push(' ');
            structural.push_str(&lex.structure[start..pos]);
            structural.push(' ');
            start = pairs[&pos] + 1;
        }
        direct.push_str(&lex.comments[start..end]);
        structural.push_str(&lex.structure[start..end]);
        let mut obj = Object {
            id: cap[1].into(),
            ..Default::default()
        };
        let properties =
            pattern!(r"\b(isa|name|buildConfigurationList|baseConfigurationReference)[ \t]*=");
        for prop in properties.captures_iter(&structural) {
            let start = prop.get(0).unwrap().end();
            let Some(end) = structural[start..].find(';') else {
                continue;
            };
            let value = decode(direct[start..start + end].trim());
            match &prop[1] {
                "isa" => obj.isa = value,
                "name" => obj.name = value,
                "buildConfigurationList" => obj.list = value,
                _ => obj.base = true,
            }
        }
        match obj.isa.as_str() {
            "XCConfigurationList" => {
                let ids = pattern!(r"\bbuildConfigurations[ \t]*=[ \t]*\(([^)]*)\);")
                    .captures(&structural)
                    .map(|cap| {
                        pattern!(r"\b[A-Za-z0-9]{4,32}\b")
                            .find_iter(&cap[1])
                            .map(|m| m.as_str().to_owned())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                lists.insert(obj.id, ids);
            }
            "PBXNativeTarget" => targets.push(obj),
            "XCBuildConfiguration" => {
                let first = blocks.partition_point(|b| b.open <= open);
                let last = blocks.partition_point(|b| b.open < end);
                if last > first + 1 {
                    return Err(error(
                        "AMBIGUOUS",
                        "An XCBuildConfiguration contains multiple buildSettings blocks.",
                        path,
                    )
                    .with(json!({"objectId":obj.id})));
                }
                if first < last {
                    let block = &mut blocks[first];
                    block.id = obj.id.clone();
                    block.name = obj.name.clone();
                    block.base = obj.base;
                    obj.block = Some(first);
                }
                configs.insert(obj.id.clone(), obj);
            }
            _ => {}
        }
    }
    for target in &mut targets {
        if target.name.is_empty() || target.list.is_empty() {
            return Err(error(
                "PARSE_ERROR",
                "A PBXNativeTarget is missing its name or build configuration list.",
                path,
            )
            .with(json!({"targetId":target.id})));
        }
        target.ids = lists.get(&target.list).cloned().ok_or_else(|| {
            error(
                "PARSE_ERROR",
                "An iOS target references an unknown configuration list.",
                path,
            )
            .with(json!({"target":target.name,"configurationList":target.list}))
        })?;
        for id in &target.ids {
            if let Some(n) = configs.get(id).and_then(|c| c.block)
                && !blocks[n].targets.contains(&target.name)
            {
                blocks[n].targets.push(target.name.clone());
            }
        }
    }
    Ok(Graph { configs, targets })
}
impl Graph {
    fn select(
        &self,
        s: &Selection,
        active: BTreeSet<usize>,
        path: &str,
    ) -> Result<BTreeSet<usize>> {
        if s.target.is_some() && s.all_targets {
            return Err(error(
                "VALIDATION_ERROR",
                "--ios-target and --all-targets cannot be used together.",
                "--ios-target",
            ));
        }
        if self.targets.is_empty() {
            return if s.explicit() {
                Err(error(
                    "PARSE_ERROR",
                    "Explicit iOS target/configuration selection requires PBXNativeTarget metadata.",
                    path,
                ))
            } else {
                Ok(active)
            };
        }
        let details = || json!({"targets":self.targets.iter().map(|t|json!({"name":t.name,"configurations":t.ids.iter().map(|id|self.configs.get(id).map(|o|&o.name).unwrap_or(id)).collect::<Vec<_>>()})).collect::<Vec<_>>()});
        let targets: Vec<_> = self
            .targets
            .iter()
            .filter(|t| s.target.as_ref().is_none_or(|name| *name == t.name))
            .collect();
        if let Some(name) = &s.target {
            if targets.is_empty() {
                return Err(error(
                    "NOT_FOUND",
                    format!("Could not find iOS target {name}."),
                    path,
                )
                .with(details()));
            }
            if targets.len() > 1 {
                return Err(error(
                    "AMBIGUOUS",
                    format!("Multiple iOS targets are named {name}."),
                    path,
                )
                .with(details()));
            }
        } else if !s.all_targets && targets.len() > 1 {
            return Err(error(
                "AMBIGUOUS",
                "Multiple iOS targets were found; use --ios-target or --all-targets.",
                path,
            )
            .with(details()));
        }
        let mut selected = BTreeSet::new();
        for t in targets {
            let mut matches = 0;
            for id in &t.ids {
                let c = self.configs.get(id).ok_or_else(|| {
                    error(
                        "PARSE_ERROR",
                        "An iOS target references an unknown build configuration.",
                        path,
                    )
                    .with(json!({"target":t.name,"configurationId":id}))
                })?;
                if s.configuration.as_ref().is_some_and(|n| *n != c.name) {
                    continue;
                }
                matches += 1;
                selected.insert(c.block.ok_or_else(||error("PARSE_ERROR","A selected iOS configuration has no buildSettings block.",path).with(json!({"configurationId":id,"configuration":c.name,"source":if c.base{"xcconfig"}else{"pbxproj"}})))?);
            }
            let name = s.configuration.as_deref().unwrap_or("undefined");
            if matches == 0 {
                return Err(error(
                    "NOT_FOUND",
                    format!(
                        "Could not find iOS configuration {name} for target {}.",
                        t.name
                    ),
                    path,
                )
                .with(details()));
            }
            if matches > 1 && s.configuration.is_some() {
                return Err(error(
                    "AMBIGUOUS",
                    format!(
                        "Target {} has multiple configurations named {name}.",
                        t.name
                    ),
                    path,
                )
                .with(details()));
            }
        }
        Ok(selected)
    }
}
struct Assignment<'a> {
    field: &'a str,
    expr: &'a str,
    value: &'a str,
    span: Range<usize>,
    block: Option<usize>,
    line: usize,
}
impl Assignment<'_> {
    fn detail(&self, blocks: &[Block]) -> Value {
        let mut data = self
            .block
            .map(|i| blocks[i].metadata())
            .unwrap_or(json!({}));
        data["field"] = json!(self.field);
        data["value"] = json!(self.value);
        data["expression"] = json!(self.expr);
        data["line"] = json!(self.line);
        data["buildSettings"] = json!(self.block.map(|i| i + 1));
        data
    }
}
pub fn analyze(text: &str, path: &str, selection: &Selection) -> Result<Source> {
    let lex = Lexed::new(text, false);
    let pairs = braces(&lex.structure);
    let mut blocks = Vec::new();
    for m in pattern!(r"\bbuildSettings[ \t]*=[ \t]*\{").find_iter(&lex.structure) {
        let open = m.end() - 1;
        blocks.push(Block {
            open,
            close: closing(
                &pairs,
                open,
                "An iOS buildSettings block is not balanced.",
                path,
            )?,
            ..Default::default()
        });
    }
    let graph = graph(&lex, &pairs, &mut blocks, path)?;
    let mut fields = Vec::new();
    let mut scan = 0;
    let mut line = 1;
    for m in
        pattern!(r"(?m)^[ \t]*(CURRENT_PROJECT_VERSION|MARKETING_VERSION)[ \t]*=[ \t]*([^;\r\n]*);")
            .captures_iter(&lex.comments)
    {
        let field = m.get(1).unwrap();
        let pos = field.start();
        if !lex.structure[pos..].starts_with(field.as_str()) {
            continue;
        }
        line += text[scan..pos].bytes().filter(|b| *b == b'\n').count();
        scan = pos;
        let expr = m.get(2).unwrap().as_str().trim();
        let value = expr
            .strip_prefix('"')
            .and_then(|s| s.strip_suffix('"'))
            .unwrap_or(expr);
        let start = value.as_ptr() as usize - lex.comments.as_ptr() as usize;
        let block = blocks
            .partition_point(|b| b.open < pos)
            .checked_sub(1)
            .filter(|i| pos < blocks[*i].close);
        fields.push(Assignment {
            field: field.as_str(),
            expr,
            value,
            span: start..start + value.len(),
            block,
            line,
        });
    }
    let candidates = |items: Vec<&Assignment>| json!({"candidates":items.iter().map(|a|a.detail(&blocks)).collect::<Vec<_>>()});
    let outside: Vec<_> = fields.iter().filter(|a| a.block.is_none()).collect();
    if !outside.is_empty() {
        return Err(error(
            "AMBIGUOUS",
            "iOS version assignments outside buildSettings are not supported.",
            path,
        )
        .with(candidates(outside)));
    }
    let selected = graph.select(
        selection,
        fields.iter().filter_map(|a| a.block).collect(),
        path,
    )?;
    if selected.is_empty() {
        return Err(if lex.structure.contains("baseConfigurationReference") {
            error(
                "PARSE_ERROR",
                "No literal iOS versions were found; the project references an .xcconfig source.",
                path,
            )
            .with(json!({"source":"xcconfig"}))
        } else {
            error(
                "PARSE_ERROR",
                "Could not find iOS version assignments inside buildSettings.",
                path,
            )
        });
    }
    let mut groups: BTreeMap<usize, Vec<&Assignment>> = BTreeMap::new();
    for a in &fields {
        groups.entry(a.block.unwrap()).or_default().push(a);
    }
    let mut picked = Vec::new();
    for i in selected {
        let group = groups.remove(&i).unwrap_or_default();
        if group.len() != 2 || group[0].field == group[1].field {
            let mut data = blocks[i].metadata();
            if group.is_empty() && blocks[i].base {
                data["source"] = json!("xcconfig");
                return Err(error("PARSE_ERROR","No literal iOS versions were found in the selected configuration; it references an .xcconfig source.",path).with(data));
            }
            data["buildSettings"] = json!(i + 1);
            data["candidates"] = candidates(group)["candidates"].take();
            return Err(error(
                "AMBIGUOUS",
                "Each supported buildSettings block must contain exactly one paired iOS version.",
                path,
            )
            .with(data));
        }
        picked.extend(group);
    }
    let indirect: Vec<_> = picked
        .iter()
        .copied()
        .filter(|a| !a.value.split('.').all(digits) || a.value.split('.').count() > 3)
        .collect();
    if !indirect.is_empty() {
        return Err(error(
            "PARSE_ERROR",
            "iOS versions must be direct numeric literals, not variables or inherited values.",
            path,
        )
        .with(candidates(indirect)));
    }
    let spans = |field| {
        picked
            .iter()
            .filter(|a| a.field == field)
            .map(|a| a.span.clone())
            .collect::<Vec<_>>()
    };
    let builds = spans("CURRENT_PROJECT_VERSION");
    let marketing = spans("MARKETING_VERSION");
    let current = Versions {
        build: text[builds[0].clone()].into(),
        marketing: text[marketing[0].clone()].into(),
    };
    if builds.iter().any(|r| text[r.clone()] != current.build)
        || marketing
            .iter()
            .any(|r| text[r.clone()] != current.marketing)
    {
        return Err(error(
            "AMBIGUOUS",
            "Divergent iOS versions were found across buildSettings blocks.",
            path,
        )
        .with(candidates(picked)));
    }
    if positive(&current.build, "CURRENT_PROJECT_VERSION").is_err()
        || semantic(&current.marketing, "iOS").is_err()
    {
        return Err(error(
            "PARSE_ERROR",
            "The iOS project contains an unsupported version literal.",
            path,
        ));
    }
    Ok(Source {
        current,
        builds,
        marketing,
    })
}
