use super::tests::Fixture;
use super::*;
use serde_json::json;

const OWNER: &str = "extension.sample";

fn broker(fixture: &Fixture) -> Broker {
    let broker = Broker::new(fixture.0.clone());
    broker
        .grant(
            OWNER,
            [
                "state.read",
                "state.write",
                "state.batch",
                "records.list",
                "records.search",
            ]
            .map(String::from)
            .to_vec(),
        )
        .unwrap();
    broker
}
fn batch(broker: &Broker, payload: Value) -> Result<Value, StateErrorCode> {
    broker.call(OWNER, "state.batch", payload)
}
fn list(broker: &Broker, payload: Value) -> Result<Value, StateErrorCode> {
    broker.call(OWNER, "records.list", payload)
}
fn search(broker: &Broker, payload: Value) -> Result<Value, StateErrorCode> {
    broker.call(OWNER, "records.search", payload)
}
fn ids(page: &Value) -> Vec<String> {
    page["records"]
        .as_array()
        .unwrap()
        .iter()
        .map(|record| record["id"].as_str().unwrap().to_owned())
        .collect()
}
fn put(collection: &str, id: &str, text: &str) -> Value {
    json!({"collection": collection, "id": id, "revision": 0, "value": {"text": text}, "text": text})
}

#[test]
fn a_batch_commits_documents_and_records_together() {
    let fixture = Fixture::new();
    let broker = broker(&fixture);
    let receipt = batch(
        &broker,
        json!({
            "documents": [{"revision": 0, "value": "index"}, {"key": "a-1", "revision": 0, "value": 1}],
            "records": [put("session:1", "m-1", "你好"), {"collection": "session:1", "id": "m-2", "revision": 0, "value": 2, "parent": "m-1"}]
        }),
    )
    .unwrap();
    assert_eq!(
        receipt,
        json!({"documents": [{"revision": 1}, {"revision": 1}], "records": [{"seq": 1, "revision": 1}, {"seq": 2, "revision": 1}]})
    );
    drop(broker);
    let broker = self::broker(&fixture);
    assert_eq!(
        broker.call(OWNER, "state.read", Value::Null).unwrap()["value"],
        "index"
    );
    let page = list(&broker, json!({"collection": "session:1"})).unwrap();
    assert_eq!(
        page,
        json!({"records": [
            {"collection": "session:1", "id": "m-1", "seq": 1, "parent": null, "revision": 1, "value": {"text": "你好"}, "text": "你好"},
            {"collection": "session:1", "id": "m-2", "seq": 2, "parent": "m-1", "revision": 1, "value": 2, "text": null}
        ], "next": null})
    );
}

#[test]
fn one_stale_revision_rejects_the_whole_batch() {
    let fixture = Fixture::new();
    let broker = broker(&fixture);
    batch(&broker, json!({"documents": [{"revision": 0, "value": "index"}], "records": [put("c", "a", "one")]})).unwrap();
    for stale in [
        json!({"documents": [{"revision": 1, "value": "new"}], "records": [put("c", "a", "again")]}),
        json!({"documents": [{"revision": 0, "value": "new"}], "records": [put("c", "b", "two")]}),
        json!({"documents": [{"revision": 1, "value": "new"}], "records": [{"collection": "c", "id": "a", "revision": 2, "remove": true}]}),
    ] {
        assert_eq!(
            batch(&broker, stale).unwrap_err(),
            StateErrorCode::RevisionConflict
        );
    }
    assert_eq!(
        broker.call(OWNER, "state.read", Value::Null).unwrap()["value"],
        "index"
    );
    assert_eq!(
        ids(&list(&broker, json!({"collection": "c"})).unwrap()),
        ["a"]
    );
    // The rejected batches used no sequence numbers either.
    let receipt = batch(&broker, json!({"records": [put("c", "b", "two")]})).unwrap();
    assert_eq!(receipt["records"][0]["seq"], 2);
}

#[test]
fn records_keep_their_place_and_check_revisions() {
    let fixture = Fixture::new();
    let broker = broker(&fixture);
    batch(
        &broker,
        json!({"records": [put("c", "a", "one"), put("c", "b", "two")]}),
    )
    .unwrap();
    let receipt = batch(
        &broker,
        json!({"records": [{"collection": "c", "id": "a", "revision": 1, "value": "edited", "text": "edited"}]}),
    )
    .unwrap();
    assert_eq!(receipt["records"][0], json!({"seq": 1, "revision": 2}));
    assert_eq!(
        ids(&list(&broker, json!({"collection": "c"})).unwrap()),
        ["a", "b"]
    );
    let remove = |id: &str, revision: u64| {
        batch(
            &broker,
            json!({"records": [{"collection": "c", "id": id, "revision": revision, "remove": true}]}),
        )
    };
    assert_eq!(
        remove("a", 1).unwrap_err(),
        StateErrorCode::RevisionConflict
    );
    assert_eq!(
        remove("a", 2).unwrap(),
        json!({"documents": [], "records": [null]})
    );
    assert_eq!(
        remove("a", 0).unwrap(),
        json!({"documents": [], "records": [null]})
    );
    assert_eq!(
        remove("z", 1).unwrap_err(),
        StateErrorCode::RevisionConflict
    );
    assert_eq!(
        ids(&list(&broker, json!({"collection": "c"})).unwrap()),
        ["b"]
    );
    // A record put again after removal goes to the end.
    let again = batch(&broker, json!({"records": [put("c", "a", "back")]})).unwrap();
    assert_eq!(again["records"][0], json!({"seq": 3, "revision": 1}));
}

#[test]
fn lists_page_forwards_and_backwards_by_cursor() {
    let fixture = Fixture::new();
    let broker = broker(&fixture);
    let records: Vec<_> = (1..=5).map(|n| put("c", &format!("m-{n}"), "x")).collect();
    batch(&broker, json!({"records": records})).unwrap();
    batch(&broker, json!({"records": [put("other", "o", "x")]})).unwrap();
    let first = list(&broker, json!({"collection": "c", "limit": 2})).unwrap();
    assert_eq!(ids(&first), ["m-1", "m-2"]);
    let second = list(
        &broker,
        json!({"collection": "c", "limit": 2, "after": first["next"]}),
    )
    .unwrap();
    assert_eq!(ids(&second), ["m-3", "m-4"]);
    let last = list(
        &broker,
        json!({"collection": "c", "limit": 2, "after": second["next"]}),
    )
    .unwrap();
    assert_eq!(ids(&last), ["m-5"]);
    assert_eq!(last["next"], Value::Null);
    let newest = list(
        &broker,
        json!({"collection": "c", "limit": 3, "order": "desc"}),
    )
    .unwrap();
    assert_eq!(ids(&newest), ["m-5", "m-4", "m-3"]);
    let older = list(
        &broker,
        json!({"collection": "c", "limit": 3, "order": "desc", "after": newest["next"]}),
    )
    .unwrap();
    assert_eq!(ids(&older), ["m-2", "m-1"]);
    assert_eq!(older["next"], Value::Null);
    assert_eq!(
        list(&broker, json!({"collection": "none"})).unwrap(),
        json!({"records": [], "next": null})
    );
    for bad in [
        json!({"collection": "c", "limit": 0}),
        json!({"collection": "c", "limit": 201}),
        json!({"collection": "c", "order": "up"}),
        json!({"collection": "c", "after": "x"}),
        json!({"collection": "c", "after": 3}),
    ] {
        assert_eq!(
            list(&broker, bad).unwrap_err(),
            StateErrorCode::InvalidQuery
        );
    }
    assert_eq!(
        list(&broker, json!({})).unwrap_err(),
        StateErrorCode::InvalidCollection
    );
}

#[test]
fn clearing_a_collection_runs_before_the_puts_of_the_same_batch() {
    let fixture = Fixture::new();
    let broker = broker(&fixture);
    batch(
        &broker,
        json!({"records": [put("c", "a", "old"), put("c", "b", "old"), put("keep", "k", "old")]}),
    )
    .unwrap();
    batch(
        &broker,
        json!({"clear": ["c"], "records": [put("c", "a", "new")]}),
    )
    .unwrap();
    let page = list(&broker, json!({"collection": "c"})).unwrap();
    assert_eq!(ids(&page), ["a"]);
    assert_eq!(page["records"][0]["revision"], 1);
    assert_eq!(
        ids(&list(&broker, json!({"collection": "keep"})).unwrap()),
        ["k"]
    );
    assert_eq!(
        search(&broker, json!({"query": "old"})).unwrap()["records"][0]["id"],
        "k"
    );
}

#[test]
fn search_finds_substrings_newest_first() {
    let fixture = Fixture::new();
    let broker = broker(&fixture);
    batch(
        &broker,
        json!({"records": [
            put("a", "1", "明天的会议改到三点"),
            put("a", "2", "Plums Meeting notes"),
            put("b", "3", "会议纪要"),
            put("a", "4", "100% done_ok"),
            {"collection": "a", "id": "5", "revision": 0, "value": "会议"}
        ]}),
    )
    .unwrap();
    let found = |payload: Value| ids(&search(&broker, payload).unwrap());
    assert_eq!(found(json!({"query": "会议"})), ["3", "1"]);
    assert_eq!(found(json!({"query": "会议", "collection": "a"})), ["1"]);
    assert_eq!(found(json!({"query": "改到三点"})), ["1"]);
    assert_eq!(found(json!({"query": "meeting"})), ["2"]);
    assert_eq!(found(json!({"query": "  NOTES "})), ["2"]);
    assert_eq!(found(json!({"query": "0%"})), ["4"]);
    assert_eq!(found(json!({"query": "e_o"})), ["4"]);
    assert_eq!(found(json!({"query": "%"})), ["4"]);
    assert_eq!(found(json!({"query": "_"})), ["4"]);
    assert_eq!(found(json!({"query": "会议", "limit": 1})), ["3"]);
    let hit = search(&broker, json!({"query": "纪要"})).unwrap();
    assert_eq!(hit["records"][0]["collection"], "b");
    assert_eq!(hit["records"][0]["value"], json!({"text": "会议纪要"}));
    // Edited and removed records leave the index.
    batch(
        &broker,
        json!({"records": [
            {"collection": "b", "id": "3", "revision": 1, "value": "x", "text": "已归档"},
            {"collection": "a", "id": "1", "revision": 1, "remove": true}
        ]}),
    )
    .unwrap();
    assert!(found(json!({"query": "会议"})).is_empty());
    assert_eq!(found(json!({"query": "归档"})), ["3"]);
    for bad in [
        json!({"query": ""}),
        json!({"query": "   "}),
        json!({"query": 1}),
        json!({"query": "x".repeat(257)}),
        json!({"query": "x", "limit": 101}),
    ] {
        assert_eq!(
            search(&broker, bad).unwrap_err(),
            StateErrorCode::InvalidQuery
        );
    }
}

#[test]
fn invalid_batches_write_nothing() {
    let fixture = Fixture::new();
    let broker = broker(&fixture);
    let cases = [
        (json!(null), StateErrorCode::InvalidBatch),
        (json!({}), StateErrorCode::InvalidBatch),
        (json!({"records": {}}), StateErrorCode::InvalidBatch),
        (
            json!({"documents": [{"revision": 0, "value": 1}, {"key": null, "revision": 0, "value": 2}]}),
            StateErrorCode::InvalidBatch,
        ),
        (
            json!({"records": [put("c", "a", "x"), put("c", "a", "y")]}),
            StateErrorCode::InvalidBatch,
        ),
        (json!({"clear": ["c", "c"]}), StateErrorCode::InvalidBatch),
        (
            json!({"documents": [{"key": "A", "revision": 0, "value": 1}]}),
            StateErrorCode::InvalidKey,
        ),
        (
            json!({"documents": [{"revision": 0}]}),
            StateErrorCode::MissingValue,
        ),
        (
            json!({"documents": [{"value": 1}]}),
            StateErrorCode::MissingRevision,
        ),
        (
            json!({"records": [put("", "a", "x")]}),
            StateErrorCode::InvalidCollection,
        ),
        (
            json!({"records": [put("a b", "a", "x")]}),
            StateErrorCode::InvalidCollection,
        ),
        (
            json!({"clear": ["x".repeat(129)]}),
            StateErrorCode::InvalidCollection,
        ),
        (
            json!({"records": [put("c", "-a", "x")]}),
            StateErrorCode::InvalidRecord,
        ),
        (
            json!({"records": [{"collection": "c", "id": "a", "revision": 0, "value": 1, "parent": 7}]}),
            StateErrorCode::InvalidRecord,
        ),
        (
            json!({"records": [{"collection": "c", "id": "a", "revision": 0, "value": 1, "text": 7}]}),
            StateErrorCode::InvalidRecord,
        ),
        (
            json!({"records": [{"collection": "c", "id": "a", "revision": 0}]}),
            StateErrorCode::MissingValue,
        ),
    ];
    for (payload, code) in cases {
        assert_eq!(
            batch(&broker, payload.clone()).unwrap_err(),
            code,
            "{payload}"
        );
    }
    let many: Vec<_> = (0..=MAX_BATCH_OPERATIONS)
        .map(|n| put("c", &format!("m{n}"), "x"))
        .collect();
    assert_eq!(
        batch(&broker, json!({"records": many})).unwrap_err(),
        StateErrorCode::InvalidBatch
    );
    // Validation happens before storage is opened.
    assert!(fixture.names("state").is_empty());
}

#[test]
fn documents_take_one_mebibyte_and_records_eight() {
    let fixture = Fixture::new();
    let broker = broker(&fixture);
    let write = |revision: u64, size: usize| {
        broker.call(
            OWNER,
            "state.write",
            json!({"revision": revision, "value": "x".repeat(size)}),
        )
    };
    write(0, MAX_DOCUMENT - 64).unwrap();
    assert_eq!(
        write(1, MAX_DOCUMENT).unwrap_err(),
        StateErrorCode::StateTooLarge
    );
    let record = |id: &str, value: usize, text: usize| {
        batch(
            &broker,
            json!({"records": [{"collection": "c", "id": id, "revision": 0, "value": "x".repeat(value), "text": "y".repeat(text)}]}),
        )
    };
    record("a", MAX_RECORD - 1024, 0).unwrap();
    assert_eq!(
        record("b", MAX_RECORD, 0).unwrap_err(),
        StateErrorCode::StateTooLarge
    );
    assert_eq!(
        record("b", MAX_RECORD / 2, MAX_RECORD / 2).unwrap_err(),
        StateErrorCode::StateTooLarge
    );
}

#[test]
fn pages_stop_before_sixteen_mebibytes_but_hold_at_least_one_record() {
    let fixture = Fixture::new();
    let broker = broker(&fixture);
    let big = "x".repeat(MAX_RECORD - 1024);
    for id in ["a", "b", "c"] {
        batch(&broker, json!({"records": [{"collection": "c", "id": id, "revision": 0, "value": big, "text": "长"}]})).unwrap();
    }
    let first = list(&broker, json!({"collection": "c"})).unwrap();
    assert_eq!(ids(&first), ["a", "b"]);
    let rest = list(&broker, json!({"collection": "c", "after": first["next"]})).unwrap();
    assert_eq!(ids(&rest), ["c"]);
    assert_eq!(rest["next"], Value::Null);
    let found = search(&broker, json!({"query": "长"})).unwrap();
    assert_eq!(ids(&found), ["c", "b"]);
    let older = search(&broker, json!({"query": "长", "after": found["next"]})).unwrap();
    assert_eq!(ids(&older), ["a"]);
    assert_eq!(older["next"], Value::Null);
}

#[test]
fn records_need_their_own_grant_and_stay_with_their_owner() {
    let fixture = Fixture::new();
    let plain = fixture.broker();
    assert_eq!(
        plain
            .call(
                OWNER,
                "state.batch",
                json!({"records": [put("c", "a", "x")]})
            )
            .unwrap_err(),
        StateErrorCode::PermissionDenied
    );
    assert_eq!(
        plain
            .call(OWNER, "records.list", json!({"collection": "c"}))
            .unwrap_err(),
        StateErrorCode::PermissionDenied
    );
    let broker = broker(&fixture);
    batch(&broker, json!({"records": [put("c", "a", "secret")]})).unwrap();
    let other = "extension.other";
    broker
        .grant(other, vec!["records.list".into(), "records.search".into()])
        .unwrap();
    assert_eq!(
        broker
            .call(other, "records.list", json!({"collection": "c"}))
            .unwrap()["records"],
        json!([])
    );
    assert_eq!(
        broker
            .call(other, "records.search", json!({"query": "secret"}))
            .unwrap()["records"],
        json!([])
    );
}

#[test]
fn a_database_from_before_records_is_upgraded_in_place() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.0.join("state")).unwrap();
    {
        let connection =
            Connection::open(fixture.0.join("state").join(format!("{OWNER}.sqlite3"))).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE documents (key TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, value TEXT, error TEXT) STRICT;
                 INSERT INTO documents VALUES ('', 4, '\"kept\"', NULL);
                 PRAGMA user_version = 1;",
            )
            .unwrap();
    }
    let broker = broker(&fixture);
    let saved = broker.call(OWNER, "state.read", Value::Null).unwrap();
    assert_eq!(saved, json!({"schema": 1, "revision": 4, "value": "kept"}));
    batch(
        &broker,
        json!({"documents": [{"revision": 4, "value": "new"}], "records": [put("c", "a", "x")]}),
    )
    .unwrap();
    drop(broker);
    let connection =
        Connection::open(fixture.0.join("state").join(format!("{OWNER}.sqlite3"))).unwrap();
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 2);
}
