// Statements the owner runs by hand in the Neon SQL editor; docs/deploy.md quotes them.

// Only when the earlier version (before storage per space) has to stay live against a 0013 database: its upload insert
// names the unfinished-upload rule without space_id, which 0013 replaced, so every new upload fails. This puts the old
// rule back next to the new one, so both versions can start uploads.
export const BEFORE_GOING_BACK_PAST_0013 =
  "create unique index assets_unfinished_upload_old on assets (uploaded_by, file_name, size_bytes, last_modified_ms) where status = 'uploading';";

// After coming forward to the version with storage per space again: the old rule would stop the same file being
// pending in two spaces.
export const AFTER_COMING_FORWARD = "drop index assets_unfinished_upload_old;";
