use chrono::{Datelike, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Write, path::Path};

pub const TOTAL_WEEKS: u32 = 4680;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    #[default]
    Horizontal,
    Vertical,
}

fn default_centered() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DisplayScale {
    Small,
    #[default]
    Medium,
    Large,
}

impl DisplayScale {
    pub fn factor(self) -> f64 {
        match self {
            Self::Small => 1.0,
            Self::Medium => 1.25,
            Self::Large => 1.5,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Milestone {
    pub title: String,
    pub details: String,
    pub kind: String,
    pub color: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppData {
    pub version: u32,
    pub birth_date: Option<String>,
    pub target_age: u32,
    pub breathing: bool,
    #[serde(default)]
    pub orientation: Orientation,
    #[serde(default = "default_centered")]
    pub centered: bool,
    #[serde(default)]
    pub display_scale: DisplayScale,
    pub milestones: BTreeMap<u32, Milestone>,
    pub position: Option<Position>,
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            version: 1,
            birth_date: None,
            target_age: 90,
            breathing: true,
            orientation: Orientation::Horizontal,
            centered: true,
            display_scale: DisplayScale::Medium,
            milestones: BTreeMap::new(),
            position: None,
        }
    }
}

pub fn validate(data: &AppData) -> Result<(), String> {
    if data.version != 1 || data.target_age != 90 {
        return Err("不支持的数据版本或目标年龄；当前版本固定为 90 岁。".into());
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
            || !matches!(mark.kind.as_str(), "milestone" | "wish")
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
    let data = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("无法读取人生周历：{e}"))?;
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_data_defaults_to_horizontal_and_centered() {
        let data: AppData = serde_json::from_str(r#"{"version":1,"birthDate":null,"targetAge":90,"breathing":true,"milestones":{},"position":{"x":10,"y":20}}"#).unwrap();
        assert_eq!(data.orientation, Orientation::Horizontal);
        assert!(data.centered);
        assert_eq!(data.display_scale, DisplayScale::Medium);
        let restored: AppData = serde_json::from_str(
            &serde_json::to_string(&AppData {
                orientation: Orientation::Vertical,
                centered: false,
                display_scale: DisplayScale::Large,
                ..data
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(restored.orientation, Orientation::Vertical);
        assert!(!restored.centered);
        assert_eq!(restored.display_scale, DisplayScale::Large);
    }
    #[test]
    fn saves_replaces_and_keeps_previous_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("milestones.json");
        let mut data = AppData::default();
        write_data(&path, &data).unwrap();
        data.birth_date = Some("1995-05-18".into());
        data.milestones.insert(
            4679,
            Milestone {
                title: "最后一周".into(),
                details: "中文、换行\n与符号".into(),
                kind: "wish".into(),
                color: "#FACC15".into(),
            },
        );
        write_data(&path, &data).unwrap();
        assert_eq!(
            read_data(&path).unwrap().milestones[&4679].details,
            "中文、换行\n与符号"
        );
        assert!(read_data(&path.with_extension("json.bak"))
            .unwrap()
            .birth_date
            .is_none());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
    #[test]
    fn invalid_input_cannot_replace_existing_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("milestones.json");
        let mut data = AppData::default();
        write_data(&path, &data).unwrap();
        let original = fs::read(&path).unwrap();
        data.birth_date = Some("2024-02-30".into());
        assert!(write_data(&path, &data).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        data.birth_date = None;
        data.milestones.insert(
            4680,
            Milestone {
                title: "超出范围".into(),
                details: "".into(),
                kind: "wish".into(),
                color: "#FACC15".into(),
            },
        );
        assert!(write_data(&path, &data).is_err());
    }
    #[test]
    fn corrupt_data_is_reported_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("milestones.json");
        fs::write(&path, b"{broken").unwrap();
        assert!(read_data(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{broken");
    }
}
