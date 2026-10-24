//! Records and atomic batches in an owner's database. A record is a value in
//! a collection, kept in insertion order (`seq`) with its own revision; its
//! optional `text` is indexed for substring search.
use super::*;
use rusqlite::Row;

/// Tables added in schema version 2. The trigram index finds substrings of
/// three or more characters; shorter queries scan the stored text.
pub(super) const SCHEMA: &str = "
    CREATE TABLE records (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        parent TEXT,
        revision INTEGER NOT NULL,
        value TEXT NOT NULL,
        text TEXT,
        UNIQUE (collection, id)
    ) STRICT;
    CREATE INDEX records_order ON records (collection, seq);
    CREATE VIRTUAL TABLE records_text USING fts5(
        text, content = 'records', content_rowid = 'seq', tokenize = 'trigram'
    );
    CREATE TRIGGER records_text_insert AFTER INSERT ON records WHEN new.text IS NOT NULL BEGIN
        INSERT INTO records_text (rowid, text) VALUES (new.seq, new.text);
    END;
    CREATE TRIGGER records_text_delete AFTER DELETE ON records WHEN old.text IS NOT NULL BEGIN
        INSERT INTO records_text (records_text, rowid, text) VALUES ('delete', old.seq, old.text);
    END;
    CREATE TRIGGER records_text_update AFTER UPDATE OF text ON records BEGIN
        INSERT INTO records_text (records_text, rowid, text)
            SELECT 'delete', old.seq, old.text WHERE old.text IS NOT NULL;
        INSERT INTO records_text (rowid, text) SELECT new.seq, new.text WHERE new.text IS NOT NULL;
    END;";

/// Adds records to a database created before them.
pub(super) fn upgrade(connection: &mut Connection) -> Result<(), StateErrorCode> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| StateErrorCode::StateWrite)?;
    transaction
        .execute_batch(&format!("{SCHEMA} PRAGMA user_version = 2;"))
        .map_err(|_| StateErrorCode::StateWrite)?;
    transaction.commit().map_err(commit_failure)
}

/// Collection, record id and parent names.
fn valid_name(name: &str) -> bool {
    (1..=128).contains(&name.len())
        && name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b':' | b'.' | b'_' | b'-'))
}
fn name(value: Option<&Value>, error: StateErrorCode) -> Result<String, StateErrorCode> {
    match value {
        Some(Value::String(name)) if valid_name(name) => Ok(name.clone()),
        _ => Err(error),
    }
}
/// A field's value, with `null` read as absent.
fn optional<'a>(payload: &'a Value, field: &str) -> Option<&'a Value> {
    payload.get(field).filter(|value| !value.is_null())
}
fn list<'a>(payload: &'a Value, field: &str) -> Result<&'a [Value], StateErrorCode> {
    match optional(payload, field) {
        None => Ok(&[]),
        Some(Value::Array(items)) => Ok(items),
        Some(_) => Err(StateErrorCode::InvalidBatch),
    }
}
/// `limit`, from 1 to `max`, or `default` when absent.
fn limit(payload: &Value, default: u64, max: u64) -> Result<i64, StateErrorCode> {
    match optional(payload, "limit") {
        None => Ok(default as i64),
        Some(value) => value
            .as_u64()
            .filter(|limit| (1..=max).contains(limit))
            .map(|limit| limit as i64)
            .ok_or(StateErrorCode::InvalidQuery),
    }
}

/// A checked record write: `put` is `None` for a removal.
struct RecordWrite {
    collection: String,
    id: String,
    revision: u64,
    put: Option<RecordPut>,
}
struct RecordPut {
    value: String,
    parent: Option<String>,
    text: Option<String>,
}

impl RecordWrite {
    fn parse(payload: &Value) -> Result<Self, StateErrorCode> {
        let collection = name(payload.get("collection"), StateErrorCode::InvalidCollection)?;
        let id = name(payload.get("id"), StateErrorCode::InvalidRecord)?;
        let revision = payload
            .get("revision")
            .and_then(Value::as_u64)
            .ok_or(StateErrorCode::MissingRevision)?;
        let put = if payload.get("remove") == Some(&Value::Bool(true)) {
            None
        } else {
            let parent = optional(payload, "parent")
                .map(|parent| name(Some(parent), StateErrorCode::InvalidRecord))
                .transpose()?;
            let text = match optional(payload, "text") {
                None => None,
                Some(Value::String(text)) => Some(text.clone()),
                Some(_) => return Err(StateErrorCode::InvalidRecord),
            };
            let value = payload
                .get("value")
                .ok_or(StateErrorCode::MissingValue)?
                .to_string();
            if value.len() + text.as_ref().map_or(0, String::len) > MAX_RECORD {
                return Err(StateErrorCode::StateTooLarge);
            }
            Some(RecordPut {
                value,
                parent,
                text,
            })
        };
        Ok(Self {
            collection,
            id,
            revision,
            put,
        })
    }
    fn size(&self) -> usize {
        self.put.as_ref().map_or(0, |put| {
            put.value.len() + put.text.as_ref().map_or(0, String::len)
        })
    }
    /// Applies the write in `transaction`: `{seq, revision}`, or null once removed.
    fn apply(self, transaction: &Transaction) -> Result<Value, StateErrorCode> {
        let stored: Option<(i64, i64)> = transaction
            .query_row(
                "SELECT seq, revision FROM records WHERE collection = ?1 AND id = ?2",
                params![self.collection, self.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| StateErrorCode::StateRead)?;
        if self.revision as i64 != stored.map_or(0, |(_, revision)| revision) {
            return Err(StateErrorCode::RevisionConflict);
        }
        let Some(put) = self.put else {
            transaction
                .execute(
                    "DELETE FROM records WHERE collection = ?1 AND id = ?2",
                    params![self.collection, self.id],
                )
                .map_err(|_| StateErrorCode::StateWrite)?;
            return Ok(Value::Null);
        };
        if self.revision >= MAX_REVISION {
            return Err(StateErrorCode::RevisionLimit);
        }
        let revision = self.revision + 1;
        let seq = match stored {
            Some((seq, _)) => {
                transaction
                    .execute(
                        "UPDATE records SET parent = ?2, revision = ?3, value = ?4, text = ?5 WHERE seq = ?1",
                        params![seq, put.parent, revision as i64, put.value, put.text],
                    )
                    .map_err(|_| StateErrorCode::StateWrite)?;
                seq
            }
            None => {
                transaction
                    .execute(
                        "INSERT INTO records (collection, id, parent, revision, value, text)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![
                            self.collection,
                            self.id,
                            put.parent,
                            revision as i64,
                            put.value,
                            put.text
                        ],
                    )
                    .map_err(|_| StateErrorCode::StateWrite)?;
                transaction.last_insert_rowid()
            }
        };
        Ok(serde_json::json!({ "seq": seq, "revision": revision }))
    }
}

/// Document writes, collections to empty and record writes, committed together
/// in that order or not at all.
pub(super) struct Batch {
    documents: Vec<DocumentWrite>,
    clear: Vec<String>,
    records: Vec<RecordWrite>,
}

impl Batch {
    pub(super) fn parse(payload: &Value) -> Result<Self, StateErrorCode> {
        if !payload.is_object() {
            return Err(StateErrorCode::InvalidBatch);
        }
        let documents = list(payload, "documents")?
            .iter()
            .map(DocumentWrite::parse)
            .collect::<Result<Vec<_>, _>>()?;
        let clear = list(payload, "clear")?
            .iter()
            .map(|collection| name(Some(collection), StateErrorCode::InvalidCollection))
            .collect::<Result<Vec<_>, _>>()?;
        let records = list(payload, "records")?
            .iter()
            .map(RecordWrite::parse)
            .collect::<Result<Vec<_>, _>>()?;
        let count = documents.len() + clear.len() + records.len();
        if count == 0 || count > MAX_BATCH_OPERATIONS {
            return Err(StateErrorCode::InvalidBatch);
        }
        // Each document, collection and record may be named once.
        let mut keys = HashSet::new();
        let mut collections = HashSet::new();
        let mut targets = HashSet::new();
        if !documents
            .iter()
            .all(|write| keys.insert(write.key.as_str()))
            || !clear.iter().all(|name| collections.insert(name.as_str()))
            || !records
                .iter()
                .all(|write| targets.insert((write.collection.as_str(), write.id.as_str())))
        {
            return Err(StateErrorCode::InvalidBatch);
        }
        let bytes = documents.iter().map(DocumentWrite::size).sum::<usize>()
            + records.iter().map(RecordWrite::size).sum::<usize>();
        if bytes > MAX_BATCH_BYTES {
            return Err(StateErrorCode::StateTooLarge);
        }
        Ok(Self {
            documents,
            clear,
            records,
        })
    }
    /// `{documents, records}` receipts in request order: `{revision}` and
    /// `{seq, revision}`, or null for a removal.
    pub(super) fn apply(self, connection: &mut Connection) -> Result<Value, StateErrorCode> {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StateErrorCode::StateWrite)?;
        let mut documents = Vec::with_capacity(self.documents.len());
        for write in self.documents {
            documents.push(write.apply(&transaction)?.map_or(
                Value::Null,
                |document| serde_json::json!({ "revision": document.revision }),
            ));
        }
        for collection in &self.clear {
            transaction
                .execute(
                    "DELETE FROM records WHERE collection = ?1",
                    params![collection],
                )
                .map_err(|_| StateErrorCode::StateWrite)?;
        }
        let records = self
            .records
            .into_iter()
            .map(|write| write.apply(&transaction))
            .collect::<Result<Vec<_>, _>>()?;
        transaction.commit().map_err(commit_failure)?;
        Ok(serde_json::json!({ "documents": documents, "records": records }))
    }
}

const COLUMNS: &str = "records.collection, records.id, records.seq, records.parent,
    records.revision, records.value, records.text";

/// A stored row, as `records.list` and `records.search` return it.
#[derive(Serialize)]
struct StoredRecord {
    collection: String,
    id: String,
    seq: i64,
    parent: Option<String>,
    revision: i64,
    value: Value,
    text: Option<String>,
}

/// Up to `limit` rows of `sql` as `{records, next}`. A page also ends before
/// its records' values and text pass `MAX_PAGE_BYTES`, keeping at least one;
/// `next` is the last record's `seq` when more rows follow.
fn page(
    connection: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
    limit: i64,
) -> Result<Value, StateErrorCode> {
    let mut statement = connection
        .prepare(sql)
        .map_err(|_| StateErrorCode::StateRead)?;
    let mut rows = statement
        .query(params)
        .map_err(|_| StateErrorCode::StateRead)?;
    let mut records = Vec::new();
    let mut bytes = 0;
    let mut more = false;
    while let Some(row) = rows.next().map_err(|_| StateErrorCode::StateRead)? {
        let read = |row: &Row| -> rusqlite::Result<(StoredRecord, String)> {
            Ok((
                StoredRecord {
                    collection: row.get(0)?,
                    id: row.get(1)?,
                    seq: row.get(2)?,
                    parent: row.get(3)?,
                    revision: row.get(4)?,
                    value: Value::Null,
                    text: row.get(6)?,
                },
                row.get(5)?,
            ))
        };
        let (record, value) = read(row).map_err(|_| StateErrorCode::StateRead)?;
        bytes += value.len() + record.text.as_ref().map_or(0, String::len);
        if records.len() as i64 == limit || (!records.is_empty() && bytes > MAX_PAGE_BYTES) {
            more = true;
            break;
        }
        records.push(StoredRecord {
            value: serde_json::from_str(&value).map_err(|_| StateErrorCode::StateCorrupt)?,
            ..record
        });
    }
    let next = records
        .last()
        .filter(|_| more)
        .map(|record: &StoredRecord| record.seq.to_string());
    Ok(serde_json::json!({ "records": records, "next": next }))
}
/// `after`: the previous page's `next`.
fn cursor(payload: &Value) -> Result<Option<i64>, StateErrorCode> {
    match optional(payload, "after") {
        None => Ok(None),
        Some(Value::String(cursor)) if cursor.bytes().all(|c| c.is_ascii_digit()) => cursor
            .parse::<i64>()
            .ok()
            .filter(|seq| *seq > 0)
            .map(Some)
            .ok_or(StateErrorCode::InvalidQuery),
        Some(_) => Err(StateErrorCode::InvalidQuery),
    }
}

/// One page of a collection in `seq` order; `after` is the previous page's `next`.
pub(super) struct List {
    collection: String,
    after: Option<i64>,
    limit: i64,
    descending: bool,
}

impl List {
    pub(super) fn parse(payload: &Value) -> Result<Self, StateErrorCode> {
        let collection = name(payload.get("collection"), StateErrorCode::InvalidCollection)?;
        let descending = match optional(payload, "order") {
            None => false,
            Some(Value::String(order)) if order == "asc" => false,
            Some(Value::String(order)) if order == "desc" => true,
            Some(_) => return Err(StateErrorCode::InvalidQuery),
        };
        Ok(Self {
            collection,
            after: cursor(payload)?,
            limit: limit(payload, 50, 200)?,
            descending,
        })
    }
    /// `{records, next}`; `next` is null on the last page.
    pub(super) fn run(self, connection: &Connection) -> Result<Value, StateErrorCode> {
        let (bound, order) = if self.descending {
            (self.after.unwrap_or(i64::MAX), "seq < ?2 ORDER BY seq DESC")
        } else {
            (self.after.unwrap_or(0), "seq > ?2 ORDER BY seq ASC")
        };
        page(
            connection,
            &format!("SELECT {COLUMNS} FROM records WHERE collection = ?1 AND {order} LIMIT ?3"),
            params![self.collection, bound, self.limit + 1],
            self.limit,
        )
    }
}

/// Records whose text contains `query`, ignoring ASCII case, newest first.
pub(super) struct Search {
    query: String,
    collection: Option<String>,
    after: Option<i64>,
    limit: i64,
}

impl Search {
    pub(super) fn parse(payload: &Value) -> Result<Self, StateErrorCode> {
        let query = match payload.get("query") {
            Some(Value::String(query)) => query.trim(),
            _ => return Err(StateErrorCode::InvalidQuery),
        };
        if query.is_empty() || query.chars().count() > 256 {
            return Err(StateErrorCode::InvalidQuery);
        }
        let collection = optional(payload, "collection")
            .map(|collection| name(Some(collection), StateErrorCode::InvalidCollection))
            .transpose()?;
        Ok(Self {
            query: query.into(),
            collection,
            after: cursor(payload)?,
            limit: limit(payload, 20, 100)?,
        })
    }
    pub(super) fn run(self, connection: &Connection) -> Result<Value, StateErrorCode> {
        // A pattern without LIKE wildcards can use the trigram index; one
        // with them is escaped and scans.
        let wild = self.query.contains(['%', '_']);
        let pattern = if wild {
            self.query
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        } else {
            self.query
        };
        let escape = if wild { " ESCAPE '\\'" } else { "" };
        page(
            connection,
            &format!(
                "SELECT {COLUMNS} FROM records_text JOIN records ON records.seq = records_text.rowid
                 WHERE records_text.text LIKE ?1{escape} AND (?2 IS NULL OR records.collection = ?2)
                 AND records.seq < ?3 ORDER BY records.seq DESC LIMIT ?4"
            ),
            params![
                format!("%{pattern}%"),
                self.collection,
                self.after.unwrap_or(i64::MAX),
                self.limit + 1
            ],
            self.limit,
        )
    }
}
