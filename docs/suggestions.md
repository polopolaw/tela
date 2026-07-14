# Page suggestions

MR-like proposed edits. A viewer (or read-scoped agent) can propose a change
without mutating the live page; an editor+ reviews a three-way hunk diff and
applies all or selected hunks.

## Who can what

| Action | Who |
|--------|-----|
| Create | any space member (`viewer+`), including read-scoped API keys / MCP |
| List / get | space member (`viewer+`) |
| Hunks / apply / reject | `editor+` (write scope for API keys) |
| Withdraw | author of an `open` suggestion (read scope ok) |

Live `pages.body` is unchanged until apply. Apply writes through
`updatePageCore` / `afterPageWrite` with revision `source = "suggestion"`.

## Lifecycle

`open` → `approved` | `rejected` | `withdrawn`

Multiple open suggestions per page are allowed (independent reviews).

## Three-way hunks

Versions: **base** = page at `base_revision_id` when the suggestion was created,
**live** = page now, **incoming** = suggestion body/title/props.

Kinds (line-based body, scalar title, per-key props):

- `suggestion_only` — default accept suggestion
- `live_only` — default keep live
- `both_same` — auto-merge (hidden from review UI)
- `conflict` — reviewer must choose

Apply modes:

- `full` — defaults; unresolved conflicts → `409 unresolved_hunks`
- `partial` — explicit `choices` map; unresolved conflicts → `400`

## REST

| Method | Path |
|--------|------|
| `POST` | `/api/pages/{id}/suggestions` |
| `GET` | `/api/pages/{id}/suggestions?status=open` |
| `GET` | `/api/spaces/{id}/suggestions?status=open` |
| `GET` | `/api/suggestions/{id}` |
| `GET` | `/api/suggestions/{id}/hunks` |
| `POST` | `/api/suggestions/{id}/apply` `{ mode, choices?, review_note? }` |
| `POST` | `/api/suggestions/{id}/reject` |
| `POST` | `/api/suggestions/{id}/withdraw` |

Read-scope PAT carve-out: `POST /api/pages/{id}/suggestions` only (see
`auth.scopeAllowsRequest`).

## MCP

`create_suggestion`, `list_suggestions`, `get_suggestion`,
`get_suggestion_hunks`, `apply_suggestion`, `reject_suggestion`,
`withdraw_suggestion`. Prefer `create_suggestion` over `update_page` when the
change should be reviewed or the key is read-scoped.

## Notifications

- `suggestion_created` → space `editor+` (collapse unread per page)
- `suggestion_approved` / `suggestion_rejected` → author

## UI

- Viewer: **Suggest edit** → local editor (no Yjs) → submit with summary
- Editor: badge + Suggestions panel; review at
  `/spaces/{spaceId}/pages/{pageId}/suggestions/{suggestionId}`
- Space overview: **Pending suggestions**

## Tests

```bash
make test-suggestions   # cgroup-capped smoke (prefer while iterating)
make test               # full backend suite, also cgroup-capped
```
