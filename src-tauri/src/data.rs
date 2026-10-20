use chrono::{Datelike, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Write, path::Path};

pub const TOTAL_WEEKS: u32 = 4680;

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DisplayScale {
    Small,
    #[default]
    Medium,
    Large,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Milestone {
    pub title: String,
    pub details: String,
    pub color: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub version: u32,
    pub birth_date: Option<String>,
    #[serde(default)]
    pub display_scale: DisplayScale,
    pub milestones: BTreeMap<u32, Milestone>,
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            version: 2,
            birth_date: None,
            display_scale: DisplayScale::Medium,
            milestones: BTreeMap::new(),
        }
    }
}

pub fn validate(data: &AppData) -> Result<(), String> {
    if data.version != 2 {
        return Err("不支持的数据版本。".into());
    }
    if let Some(value) = &data.birth_date {
        let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|_| "出生日期格式应为 YYYY-MM-DD。")?;
        if date.format("%Y-%m-%d").to_string() != *value
            || date.year() < 1900
            || date > Local::now().date_naive()
        {
            return Err("出生日期应在 1900 年至今天之间。".into());
        }
    }
    for (week, mark) in &data.milestones {
        if *week >= TOTAL_WEEKS
            || mark.title.trim().is_empty()
            || mark.title.chars().count() > 120
            || mark.details.chars().count() > 4000
            || mark.color.len() != 7
            || !mark.color.starts_with('#')
            || !mark.color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        {
            return Err(format!("第 {} 个节点的数据不合法。", week + 1));
        }
    }
    Ok(())
}

pub fn read_data(path: &Path) -> Result<AppData, String> {
    if !path.exists() {
        return Ok(AppData::default());
    }
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > 2_000_000 {
        return Err("数据文件超过 2MB，请检查文件。".into());
    }
    let mut data: AppData = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("无法读取人生周历：{e}"))?;
    // Retired v1 settings and milestone kinds are ignored by serde; keep all user content.
    if data.version == 1 {
        data.version = 2;
    }
    validate(&data)?;
    Ok(data)
}

/// Write beside the destination, sync, then atomically replace it (including on Windows).
pub fn write_data(path: &Path, data: &AppData) -> Result<(), String> {
    validate(data)?;
    let parent = path.parent().ok_or("无效的数据路径")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(data).map_err(|e| e.to_string())?;
    if bytes.len() > 2_000_000 {
        return Err("数据超过 2MB，请缩短部分备忘或减少标记；原数据未被覆盖。".into());
    }
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    if path.exists() {
        fs::copy(path, path.with_extension("json.bak")).map_err(|e| e.to_string())?;
    }
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
