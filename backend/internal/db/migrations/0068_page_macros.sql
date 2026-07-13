-- Macro transclusion: block-level reusable content indexed by stable macro_id,
-- plus consumer-side refs tracked for backlinks.

CREATE TABLE page_macros (
  macro_id   TEXT PRIMARY KEY,
  page_id    BIGINT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  space_id   BIGINT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT tela_now()
);

CREATE INDEX page_macros_page_id_idx ON page_macros(page_id);
CREATE INDEX page_macros_space_id_idx ON page_macros(space_id);

-- Outgoing macro/page includes from a consumer page body.
-- Block ref: macro_id set, target_page_id = 0.
-- Page ref: macro_id = '', target_page_id set.
CREATE TABLE macro_refs (
  source_page_id  BIGINT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  macro_id        TEXT NOT NULL DEFAULT '',
  target_page_id  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (source_page_id, macro_id, target_page_id)
);

CREATE INDEX macro_refs_macro_id_idx ON macro_refs(macro_id) WHERE macro_id <> '';
CREATE INDEX macro_refs_target_page_id_idx ON macro_refs(target_page_id) WHERE target_page_id <> 0;
