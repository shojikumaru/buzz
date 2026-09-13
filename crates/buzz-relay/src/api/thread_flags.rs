//! Authenticated `/query` extension; invoked only after admission and channel repair.
use crate::{
    api::{api_error, internal_error},
    state::AppState,
};
use axum::{http::StatusCode, Json};
use buzz_core::{kind::KIND_THREAD_FLAG_PAGE, thread_flags::Query, TenantContext};
use serde_json::Value;

fn parse(raw: &Value) -> Result<(uuid::Uuid, Query), String> {
    let object = raw.as_object().ok_or("thread flags: expected object")?;
    if object
        .keys()
        .any(|k| !["#h", "kinds", "limit", "thread_flags"].contains(&k.as_str()))
        || raw["kinds"] != serde_json::json!([9])
    {
        return Err("thread flags: requires kinds [9] and no other filter extensions".into());
    }
    if raw.get("limit") != Some(&serde_json::json!(1)) {
        return Err("thread flags: requires legacy safety limit 1".into());
    }
    let channels = raw["#h"]
        .as_array()
        .ok_or("thread flags: requires one #h")?;
    if channels.len() != 1 {
        return Err("thread flags: requires one #h".into());
    }
    let channel = channels[0]
        .as_str()
        .and_then(|s| uuid::Uuid::parse_str(s).ok())
        .ok_or("thread flags: invalid channel")?;
    let query: Query = serde_json::from_value(raw["thread_flags"].clone())
        .map_err(|_| "thread flags: invalid query")?;
    query.validate()?;
    Ok((channel, query))
}

pub(super) async fn query(
    state: &AppState,
    tenant: &TenantContext,
    viewer: &[u8],
    raw: &Value,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (channel, query) = parse(raw).map_err(|e| api_error(StatusCode::BAD_REQUEST, &e))?;
    // Do not use cached grants for this historical projection. The row query
    // repeats authorization in its own snapshot to close the check/read race.
    let accessible = state
        .db
        .get_accessible_channel_ids(tenant.community(), viewer)
        .await
        .map_err(|e| internal_error(&format!("thread flags access: {e}")))?;
    if !accessible.contains(&channel) {
        return Err(api_error(StatusCode::FORBIDDEN, "channel unavailable"));
    }
    let page = state
        .db
        .get_thread_flag_page(tenant.community(), channel, viewer, &query)
        .await
        .map_err(|e| internal_error(&format!("thread flags query: {e}")))?;
    let channel_text = channel.to_string();
    let coordinate = format!(
        "thread-flags-v1:{channel}:{}",
        serde_json::to_string(&query).map_err(|e| internal_error(&e.to_string()))?
    );
    let tags = [["h", channel_text.as_str()], ["d", coordinate.as_str()]]
        .into_iter()
        .map(nostr::Tag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| internal_error(&e.to_string()))?;
    let content = serde_json::to_string(&page).map_err(|e| internal_error(&e.to_string()))?;
    let event =
        nostr::EventBuilder::new(nostr::Kind::Custom(KIND_THREAD_FLAG_PAGE as u16), content)
            .tags(tags)
            .sign_with_keys(&state.relay_keypair)
            .map_err(|e| internal_error(&e.to_string()))?;
    Ok(Json(serde_json::json!([event])))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_single_channel_contract() {
        let valid = serde_json::json!({"kinds":[9], "limit":1, "#h":[uuid::Uuid::new_v4()], "thread_flags":{}});
        assert!(parse(&valid).is_ok());
        let mut missing_limit = valid.clone();
        missing_limit.as_object_mut().unwrap().remove("limit");
        assert!(parse(&missing_limit).is_err());
        for (key, value) in [
            ("search", serde_json::json!("x")),
            ("limit", serde_json::json!(2)),
            ("kinds", serde_json::json!([9, 7])),
            ("#h", serde_json::json!([])),
            ("thread_flags", serde_json::json!({"limit":101})),
        ] {
            let mut invalid = valid.clone();
            invalid[key] = value;
            assert!(parse(&invalid).is_err(), "{key}");
        }
    }
}
