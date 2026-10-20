use chrono::{Datelike, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Write, path::Path};

pub const TOTAL_WEEKS: u32 = 4680;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Milestone {
    pub title: String,
    pub details: String,
    pub color: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub version: u32,
    pub birth_date: Option<String>,
    pub milestones: BTreeMap<u32, Milestone>,
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            version: 2,
            birth_date: None,
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_data_preserves_content_and_is_backed_up_before_migration() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("milestones.json");
        let legacy = r##"{"version":1,"birthDate":"1995-05-18","targetAge":90,"breathing":true,"orientation":"vertical","displayScale":"large","centered":false,"position":{"x":10,"y":20},"milestones":{"4679":{"title":"最后一周","details":"中文、换行\n与符号","kind":"wish","color":"#38BDF8"}}}"##;
        fs::write(&path, legacy).unwrap();
        let data = read_data(&path).unwrap();
        assert_eq!(data.version, 2);
        assert_eq!(data.birth_date.as_deref(), Some("1995-05-18"));
        assert_eq!(data.milestones[&4679].title, "最后一周");
        assert_eq!(data.milestones[&4679].details, "中文、换行\n与符号");
        assert_eq!(data.milestones[&4679].color, "#38BDF8");
        assert_eq!(fs::read_to_string(&path).unwrap(), legacy);
        write_data(&path, &data).unwrap();
        assert_eq!(
            fs::read_to_string(path.with_extension("json.bak")).unwrap(),
            legacy
        );
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved.as_object().unwrap().len(), 3);
        assert_eq!(saved["milestones"]["4679"].as_object().unwrap().len(), 3);
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
    #[test]
    fn unknown_versions_are_rejected_without_rewriting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("milestones.json");
        let unknown = r#"{"version":3,"birthDate":null,"milestones":{}}"#;
        fs::write(&path, unknown).unwrap();
        assert!(read_data(&path).is_err());
        assert!(write_data(
            &path,
            &AppData {
                version: 3,
                ..AppData::default()
            }
        )
        .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), unknown);
    }
}
