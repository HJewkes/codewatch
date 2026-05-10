CREATE TABLE snapshot (
  id            INTEGER PRIMARY KEY,
  ref           TEXT NOT NULL,
  commit_hash   TEXT,
  taken_at      TEXT NOT NULL,
  index_version TEXT NOT NULL,
  attrs         JSON NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_snapshot_ref ON snapshot (ref, taken_at DESC);

CREATE TABLE node (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  id            TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('package','module','file','symbol','external')),
  name          TEXT NOT NULL,
  parent_id     TEXT,
  language      TEXT,
  attrs         JSON NOT NULL DEFAULT '{}',
  PRIMARY KEY (snapshot_id, id)
);

CREATE INDEX idx_node_kind   ON node (snapshot_id, kind);
CREATE INDEX idx_node_parent ON node (snapshot_id, parent_id);

CREATE TABLE edge (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  src_id        TEXT NOT NULL,
  dst_id        TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('imports','re-exports','calls','extends','implements','references','depends-on')),
  attrs         JSON NOT NULL DEFAULT '{}',
  PRIMARY KEY (snapshot_id, src_id, dst_id, kind)
);

CREATE INDEX idx_edge_src ON edge (snapshot_id, src_id, kind);
CREATE INDEX idx_edge_dst ON edge (snapshot_id, dst_id, kind);

CREATE TABLE metric (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  value         REAL,
  unit          TEXT,
  PRIMARY KEY (snapshot_id, node_id, name)
);

CREATE INDEX idx_metric_name ON metric (snapshot_id, name, value DESC);

CREATE TABLE id_alias (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  old_id        TEXT NOT NULL,
  new_id        TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('rename','move','merge')),
  PRIMARY KEY (snapshot_id, old_id)
);

CREATE TABLE boundary (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  algorithm     TEXT NOT NULL,
  community_id  INTEGER NOT NULL,
  node_id       TEXT NOT NULL,
  modularity    REAL,
  PRIMARY KEY (snapshot_id, algorithm, node_id)
);

CREATE INDEX idx_boundary_community ON boundary (snapshot_id, algorithm, community_id);

CREATE TABLE entry_point (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  attrs         JSON NOT NULL DEFAULT '{}',
  PRIMARY KEY (snapshot_id, node_id, kind)
);
