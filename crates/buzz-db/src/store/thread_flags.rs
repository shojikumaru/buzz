//! Writer-backed root flag projection; authorization and data share one SQL snapshot.
use crate::{Db, Result};
use buzz_core::{
    thread_flags::{Cursor, Page, Query, Row as FlagRow, FLAGS, VERSION},
    CommunityId,
};
use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

// No post-limit classification: one grouped candidate per root, all predicates
// before the limit+1 probe. Metadata-less events fail closed (not known roots).
const PAGE_SQL: &str = r#"
WITH flagged AS (
 SELECT e.id, e.pubkey, e.created_at,
        left(regexp_replace(e.content, '[[:space:]]+', ' ', 'g'), 240) AS title,
        array_agg(DISTINCT translate(r.emoji, chr(65038) || chr(65039), '')) AS flags
 FROM reactions r
 JOIN events e ON e.community_id = r.community_id
   AND e.created_at = r.event_created_at AND e.id = r.event_id
 JOIN thread_metadata tm ON tm.community_id = e.community_id
   AND tm.event_created_at = e.created_at AND tm.event_id = e.id AND tm.depth = 0
 JOIN channels c ON c.community_id = e.community_id AND c.id = e.channel_id
 WHERE e.community_id = $1 AND e.channel_id = $2 AND e.kind = 9
   AND e.deleted_at IS NULL AND r.removed_at IS NULL
   AND c.deleted_at IS NULL AND c.archived_at IS NULL
   AND (c.visibility = 'open' OR EXISTS (
     SELECT 1 FROM channel_members cm WHERE cm.community_id = c.community_id
       AND cm.channel_id = c.id AND cm.pubkey = $3 AND cm.removed_at IS NULL))
   AND translate(r.emoji, chr(65038) || chr(65039), '') = ANY($4::text[])
   AND strpos(lower(e.content), lower($5)) > 0
   AND ($6::timestamptz IS NULL OR e.created_at < $6 OR (e.created_at = $6 AND e.id > $7))
 GROUP BY e.id, e.pubkey, e.created_at, e.content
)
SELECT * FROM flagged
WHERE CASE $8
 WHEN 'all' THEN true
 WHEN 'complete' THEN '☑' = ANY(flags)
 WHEN 'coordinate' THEN '🚩' = ANY(flags) AND NOT ('☑' = ANY(flags))
 WHEN 'progress' THEN '🔴' = ANY(flags) AND NOT ('☑' = ANY(flags))
 WHEN 'active' THEN NOT ('☑' = ANY(flags))
 ELSE false END
ORDER BY created_at DESC, id ASC LIMIT $9
"#;

impl Db {
    /// Query current flags for authorized roots. Caller validates query and
    /// performs normal relay admission; this SQL also fences removed membership.
    /// Archived channels produce no rows. No cross-page snapshot is promised.
    pub async fn get_thread_flag_page(
        &self,
        community: CommunityId,
        channel: Uuid,
        viewer: &[u8],
        query: &Query,
    ) -> Result<Page> {
        query
            .validate()
            .map_err(|e| crate::DbError::InvalidData(e.into()))?;
        let mut conn = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::SubscriptionHistory,
        )
        .await?;
        let timestamp = query
            .cursor
            .as_ref()
            .and_then(|c| DateTime::from_timestamp(c.created_at, 0));
        let id = query.cursor.as_ref().and_then(|c| hex::decode(&c.id).ok());
        let records = sqlx::query(PAGE_SQL)
            .bind(community.as_uuid())
            .bind(channel)
            .bind(viewer)
            .bind(FLAGS.to_vec())
            .bind(&query.q)
            .bind(timestamp)
            .bind(id)
            .bind(query.mode.as_str())
            .bind(i64::from(query.limit) + 1)
            .fetch_all(&mut *conn)
            .await?;
        let has_more = records.len() > query.limit as usize;
        let mut rows = Vec::new();
        for record in records.into_iter().take(query.limit as usize) {
            let flags: Vec<String> = record.try_get("flags")?;
            let time: DateTime<Utc> = record.try_get("created_at")?;
            rows.push(FlagRow {
                id: hex::encode(record.try_get::<Vec<u8>, _>("id")?),
                pubkey: hex::encode(record.try_get::<Vec<u8>, _>("pubkey")?),
                created_at: time.timestamp(),
                title: record.try_get("title")?,
                flags: FLAGS
                    .iter()
                    .filter(|flag| flags.iter().any(|f| f == **flag))
                    .map(|s| s.to_string())
                    .collect(),
            });
        }
        let next_cursor = if has_more {
            rows.last().map(|r| Cursor {
                created_at: r.created_at,
                id: r.id.clone(),
            })
        } else {
            None
        };
        Ok(Page {
            version: VERSION,
            channel_id: channel.to_string(),
            query: query.clone(),
            rows,
            has_more,
            next_cursor,
        })
    }
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
    use crate::{
        channel::{create_channel, ChannelType, ChannelVisibility},
        event::{insert_event_with_thread_metadata, ThreadMetadataParams},
        reaction::{add_reaction, remove_reaction},
        DbConfig,
    };
    use buzz_core::thread_flags::Mode;
    use nostr::{Event, EventBuilder, Keys, Kind, Timestamp};

    async fn insert(
        db: &Db,
        community: CommunityId,
        channel: Uuid,
        event: &Event,
        depth: Option<i32>,
    ) {
        let timestamp = DateTime::from_timestamp(event.created_at.as_secs() as i64, 0).unwrap();
        insert_event_with_thread_metadata(
            &db.pool,
            community,
            event,
            Some(channel),
            depth.map(|depth| ThreadMetadataParams {
                event_id: event.id.as_bytes(),
                event_created_at: timestamp,
                channel_id: channel,
                parent_event_id: None,
                parent_event_created_at: None,
                root_event_id: None,
                root_event_created_at: None,
                depth,
                broadcast: true,
            }),
        )
        .await
        .unwrap();
    }
    async fn react(db: &Db, community: CommunityId, event: &Event, emoji: &str) {
        add_reaction(
            &db.pool,
            community,
            event.id.as_bytes(),
            DateTime::from_timestamp(event.created_at.as_secs() as i64, 0).unwrap(),
            &event.pubkey.to_bytes(),
            emoji,
            None,
        )
        .await
        .unwrap();
    }
    async fn community(db: &Db) -> CommunityId {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO communities(id, host) VALUES($1, $2)")
            .bind(id)
            .bind(format!("flags-{id}.test"))
            .execute(&db.pool)
            .await
            .unwrap();
        CommunityId::from_uuid(id)
    }
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn flags_history_auth_and_deletion() {
        let db = Db::new(&DbConfig {
            database_url: crate::test_support::database_url(),
            ..Default::default()
        })
        .await
        .unwrap();
        let tenant = community(&db).await;
        let other = community(&db).await;
        let keys = Keys::generate();
        let viewer = keys.public_key().to_bytes();
        let channel = create_channel(
            &db.pool,
            tenant,
            "flags",
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            &viewer,
            None,
        )
        .await
        .unwrap();
        crate::channel::create_channel_with_id(
            &db.pool,
            other,
            channel.id,
            "other-flags",
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            &viewer,
            None,
        )
        .await
        .unwrap();
        let stamp = Timestamp::now();
        let make = |title: &str| {
            EventBuilder::new(Kind::Custom(9), title)
                .custom_created_at(stamp)
                .sign_with_keys(&keys)
                .unwrap()
        };
        let mut roots = vec![make("one 100%"), make("two"), make("three")];
        roots.sort_by_key(|e| e.id.to_hex());
        for root in &roots {
            insert(&db, tenant, channel.id, root, Some(0)).await;
            react(&db, tenant, root, "🚩\u{fe0f}").await;
            react(&db, tenant, root, "🔴").await;
        }
        let reply = make("reply");
        let missing = make("missing metadata reply");
        insert(&db, tenant, channel.id, &reply, Some(1)).await;
        insert(&db, tenant, channel.id, &missing, None).await;
        react(&db, tenant, &reply, "🚩").await;
        react(&db, tenant, &missing, "🚩").await;
        // Identical event coordinate in another tenant must not import completion.
        insert(&db, other, channel.id, &roots[0], Some(0)).await;
        react(&db, other, &roots[0], "☑").await;
        let mut query = Query {
            mode: Mode::Active,
            q: String::new(),
            limit: 2,
            cursor: None,
        };
        let first = db
            .get_thread_flag_page(tenant, channel.id, &viewer, &query)
            .await
            .unwrap();
        assert_eq!(first.rows.len(), 2);
        assert!(first.has_more);
        assert_eq!(first.rows[0].flags, ["🚩", "🔴"]);
        first.validate(&channel.id.to_string(), &query).unwrap();
        query.cursor = first.next_cursor;
        let last = db
            .get_thread_flag_page(tenant, channel.id, &viewer, &query)
            .await
            .unwrap();
        assert_eq!(last.rows.len(), 1);
        assert!(!last.has_more);
        assert_eq!(last.rows[0].id, roots[2].id.to_hex());
        query.cursor = None;
        query.limit = 50;
        react(&db, tenant, &roots[0], "☑\u{fe0e}").await;
        for mode in [Mode::Active, Mode::Coordinate, Mode::Progress] {
            query.mode = mode;
            assert_eq!(
                db.get_thread_flag_page(tenant, channel.id, &viewer, &query)
                    .await
                    .unwrap()
                    .rows
                    .len(),
                2
            );
        }
        query.mode = Mode::Complete;
        assert_eq!(
            db.get_thread_flag_page(tenant, channel.id, &viewer, &query)
                .await
                .unwrap()
                .rows[0]
                .id,
            roots[0].id.to_hex()
        );
        remove_reaction(
            &db.pool,
            tenant,
            roots[0].id.as_bytes(),
            DateTime::from_timestamp(stamp.as_secs() as i64, 0).unwrap(),
            &viewer,
            "☑\u{fe0e}",
        )
        .await
        .unwrap();
        assert!(db
            .get_thread_flag_page(tenant, channel.id, &viewer, &query)
            .await
            .unwrap()
            .rows
            .is_empty());
        query.mode = Mode::All;
        query.q = "%".into();
        assert_eq!(
            db.get_thread_flag_page(tenant, channel.id, &viewer, &query)
                .await
                .unwrap()
                .rows
                .len(),
            1
        );
        query.q = "_".into();
        assert!(db
            .get_thread_flag_page(tenant, channel.id, &viewer, &query)
            .await
            .unwrap()
            .rows
            .is_empty());
        query.q.clear();
        sqlx::query("UPDATE events SET deleted_at=now() WHERE community_id=$1 AND id=$2")
            .bind(tenant.as_uuid())
            .bind(roots[0].id.as_bytes().as_slice())
            .execute(&db.pool)
            .await
            .unwrap();
        assert_eq!(
            db.get_thread_flag_page(tenant, channel.id, &viewer, &query)
                .await
                .unwrap()
                .rows
                .len(),
            2
        );
        assert!(db
            .get_thread_flag_page(tenant, channel.id, &[1; 32], &query)
            .await
            .unwrap()
            .rows
            .is_empty());
        sqlx::query("UPDATE channels SET archived_at=now() WHERE community_id=$1 AND id=$2")
            .bind(tenant.as_uuid())
            .bind(channel.id)
            .execute(&db.pool)
            .await
            .unwrap();
        assert!(db
            .get_thread_flag_page(tenant, channel.id, &viewer, &query)
            .await
            .unwrap()
            .rows
            .is_empty());
        sqlx::query("UPDATE channels SET archived_at=NULL WHERE community_id=$1 AND id=$2")
            .bind(tenant.as_uuid())
            .bind(channel.id)
            .execute(&db.pool)
            .await
            .unwrap();
        crate::channel_members::add_member(
            &db.pool,
            tenant,
            channel.id,
            &[2; 32],
            buzz_core::channel::MemberRole::Owner,
            Some(&viewer),
        )
        .await
        .unwrap();
        crate::channel_members::remove_member(&db.pool, tenant, channel.id, &viewer, &viewer)
            .await
            .unwrap();
        assert!(db
            .get_thread_flag_page(tenant, channel.id, &viewer, &query)
            .await
            .unwrap()
            .rows
            .is_empty());
    }
}
