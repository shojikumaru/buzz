//! Signed, scope-fenced thread flag query. Projection events never enter message storage.
use crate::{
    app_state::AppState,
    relay::{
        assert_expected_relay_scope, assert_expected_signer, query_relay_at_with_keys,
        relay_api_base_url_with_override, relay_ws_url_with_override,
    },
};
use buzz_core_pkg::{
    kind::KIND_THREAD_FLAG_PAGE,
    thread_flags::{Page, Query},
};

fn decode(
    events: &[nostr::Event],
    relay_key: &str,
    channel: &str,
    query: &Query,
) -> Result<Page, String> {
    if events.len() != 1 || events[0].kind.as_u16() as u32 != KIND_THREAD_FLAG_PAGE {
        return Err("This relay does not support thread flags yet".into());
    }
    let event = &events[0];
    if event.pubkey.to_hex() != relay_key || event.verify().is_err() {
        return Err("Thread flag response has an invalid relay signature".into());
    }
    let page: Page =
        serde_json::from_str(&event.content).map_err(|_| "Malformed thread flag response")?;
    page.validate(channel, query)?;
    let channel_matches = event.tags.iter().any(|t| t.as_slice() == ["h", channel]);
    if !channel_matches {
        return Err("Thread flag channel mismatch".into());
    }
    Ok(page)
}

/// Fetch an authorized page using the caller's captured community and identity.
#[tauri::command]
pub async fn get_thread_flag_page(
    channel_id: String,
    query: Query,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: tauri::State<'_, AppState>,
) -> Result<Page, String> {
    query.validate()?;
    let channel = uuid::Uuid::parse_str(&channel_id)
        .map_err(|_| "Invalid channel UUID")?
        .to_string();
    let api = relay_api_base_url_with_override(&state);
    let ws = relay_ws_url_with_override(&state);
    let keys = state.signing_keys()?;
    assert_expected_relay_scope(Some(&expected_relay_url), &api)?;
    assert_expected_signer(Some(&expected_signer_pubkey), &keys.public_key().to_hex())?;
    let relay_key = crate::commands::identity_archive::fetch_relay_self_at(&state, &ws)
        .await?
        .ok_or("Relay signing identity unavailable")?;
    let events = query_relay_at_with_keys(
        &state,
        &api,
        &[serde_json::json!({"kinds":[9], "#h":[&channel], "limit":1, "thread_flags":&query})],
        &keys,
        None,
    )
    .await?;
    assert_expected_relay_scope(
        Some(&expected_relay_url),
        &relay_api_base_url_with_override(&state),
    )?;
    assert_expected_signer(
        Some(&expected_signer_pubkey),
        &state.signing_keys()?.public_key().to_hex(),
    )?;
    decode(&events, &relay_key, &channel, &query)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_missing_foreign_and_malformed_overlays() {
        let q: Query = serde_json::from_str("{}").unwrap();
        let keys = nostr::Keys::generate();
        assert!(decode(&[], &keys.public_key().to_hex(), "c", &q)
            .unwrap_err()
            .contains("does not support"));
        let event =
            nostr::EventBuilder::new(nostr::Kind::Custom(KIND_THREAD_FLAG_PAGE as u16), "{}")
                .sign_with_keys(&keys)
                .unwrap();
        assert!(decode(std::slice::from_ref(&event), &"a".repeat(64), "c", &q).is_err());
        assert!(decode(&[event], &keys.public_key().to_hex(), "c", &q).is_err());
    }
}
