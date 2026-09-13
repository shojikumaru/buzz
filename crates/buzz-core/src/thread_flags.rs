//! Query-only thread flag contract. Classification is derived from active root reactions.
use serde::{Deserialize, Serialize};

/// Current query protocol version.
pub const VERSION: u32 = 1;
/// Canonical order; variation selectors are removed by the persistence query.
pub const FLAGS: [&str; 3] = ["🚩", "🔴", "☑"];

/// Server-side filter, applied before pagination.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// Coordinating or progressing, excluding completed.
    #[default]
    Active,
    /// Coordinating, excluding completed.
    Coordinate,
    /// Progressing, excluding completed.
    Progress,
    /// Completed, regardless of other flags.
    Complete,
    /// Any flag, including completed.
    All,
}
impl Mode {
    /// Stable SQL/wire label.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Coordinate => "coordinate",
            Self::Progress => "progress",
            Self::Complete => "complete",
            Self::All => "all",
        }
    }
}
/// Composite cursor: descending seconds, ascending event ID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cursor {
    /// Root timestamp, Unix seconds.
    pub created_at: i64,
    /// Lowercase 32-byte event ID.
    pub id: String,
}
fn default_limit() -> u32 {
    50
}
/// Strict extension payload inside a single authenticated channel filter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    /// Filter applied before limit.
    #[serde(default)]
    pub mode: Mode,
    /// Literal case-insensitive body substring; no wildcard syntax.
    #[serde(default)]
    pub q: String,
    /// Maximum emitted roots.
    #[serde(default = "default_limit")]
    pub limit: u32,
    /// Last emitted root of the previous page.
    #[serde(default)]
    pub cursor: Option<Cursor>,
}
/// Strict lower-case hex identifier predicate shared by request and response checks.
pub fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl Query {
    /// Reject malformed or unbounded requests, without silently changing their meaning.
    pub fn validate(&self) -> Result<(), &'static str> {
        if !(1..=100).contains(&self.limit) || self.q.chars().count() > 200 {
            return Err("thread flags: limit must be 1..100 and query at most 200 characters");
        }
        if let Some(c) = &self.cursor {
            if !valid_id(&c.id)
                || c.created_at < 0
                || chrono::DateTime::from_timestamp(c.created_at, 0).is_none()
            {
                return Err("thread flags: invalid composite cursor");
            }
        }
        Ok(())
    }
}
/// Authorized root preview; no signed message is fabricated from this projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    /// Root ID.
    pub id: String,
    /// Original author.
    pub pubkey: String,
    /// Root timestamp.
    pub created_at: i64,
    /// Whitespace-collapsed preview, at most 240 Unicode scalar values.
    pub title: String,
    /// Distinct canonical flags in FLAGS order, including completed when present.
    pub flags: Vec<String>,
}
/// Signed query-only projection. Empty supported results still carry this envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    /// Exact protocol version.
    pub version: u32,
    /// Authorized channel UUID.
    pub channel_id: String,
    /// Exact request identity.
    pub query: Query,
    /// At most query.limit previews.
    pub rows: Vec<Row>,
    /// Server probe is the only exhaustion authority.
    pub has_more: bool,
    /// Last emitted row, only when more data exists.
    pub next_cursor: Option<Cursor>,
}
impl Page {
    /// Validate the signed projection before exposing it to the UI.
    pub fn validate(&self, channel: &str, query: &Query) -> Result<(), &'static str> {
        if self.version != VERSION || self.channel_id != channel || &self.query != query {
            return Err("thread flags: unsupported or mismatched response");
        }
        query.validate()?;
        if self.rows.len() > query.limit as usize || self.has_more != self.next_cursor.is_some() {
            return Err("thread flags: invalid page bounds");
        }
        let mut previous = query.cursor.clone();
        for row in &self.rows {
            let c = Cursor {
                created_at: row.created_at,
                id: row.id.clone(),
            };
            if !valid_id(&row.id)
                || !valid_id(&row.pubkey)
                || row.created_at < 0
                || row.title.chars().count() > 240
                || row.flags.is_empty()
                || row.flags
                    != FLAGS
                        .iter()
                        .filter(|f| row.flags.iter().any(|v| v == **f))
                        .map(|f| f.to_string())
                        .collect::<Vec<_>>()
            {
                return Err("thread flags: malformed root");
            }
            if let Some(p) = previous {
                if c.created_at > p.created_at || (c.created_at == p.created_at && c.id <= p.id) {
                    return Err("thread flags: invalid root order");
                }
            }
            previous = Some(c);
        }
        if self.has_more && (self.rows.is_empty() || self.next_cursor != previous) {
            return Err("thread flags: invalid next cursor");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unbounded_or_partial_requests() {
        for raw in [
            r#"{"limit":0}"#,
            r#"{"limit":101}"#,
            r#"{"q":"","extra":true}"#,
            r#"{"cursor":{"id":"aa"}}"#,
        ] {
            assert!(match serde_json::from_str::<Query>(raw) {
                Err(_) => true,
                Ok(q) => q.validate().is_err(),
            });
        }
        let mut q: Query = serde_json::from_str("{}").unwrap();
        q.q = "日".repeat(201);
        assert!(q.validate().is_err());
    }
    #[test]
    fn supported_empty_is_distinct_from_unknown_version() {
        let query: Query = serde_json::from_str("{}").unwrap();
        let mut page = Page {
            version: VERSION,
            channel_id: "channel".into(),
            query: query.clone(),
            rows: vec![],
            has_more: false,
            next_cursor: None,
        };
        assert!(page.validate("channel", &query).is_ok());
        page.version += 1;
        assert!(page.validate("channel", &query).is_err());
    }
}
