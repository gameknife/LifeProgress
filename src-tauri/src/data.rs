use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io, path::Path};

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DisplayScale {
    Small,
    #[default]
    Medium,
    Large,
}

#[derive(Serialize, Deserialize)]
struct Milestone {
    title: String,
    details: String,
    color: String,
}

/// Missing fields fall back to defaults and retired fields are dropped, so older files load as-is.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppData {
    birth_date: Option<String>,
    pub display_scale: DisplayScale,
    milestones: BTreeMap<u32, Milestone>,
}

/// An unreadable file is set aside and the previous save takes its place.
pub fn read(path: &Path) -> AppData {
    let parse = |path: &Path| serde_json::from_slice(&fs::read(path).ok()?).ok();
    parse(path).unwrap_or_else(|| {
        let _ = fs::rename(path, path.with_extension("json.corrupt"));
        parse(&path.with_extension("json.bak")).unwrap_or_default()
    })
}

/// Keep the previous save as a backup, then swap the new file in with a single rename.
pub fn write(path: &Path, data: &AppData) -> io::Result<()> {
    fs::create_dir_all(path.parent().unwrap())?;
    let _ = fs::copy(path, path.with_extension("json.bak"));
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(data)?)?;
    fs::rename(temp, path)
}
