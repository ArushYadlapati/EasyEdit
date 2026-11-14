// Statements the owner runs by hand in the Neon SQL editor; the README quotes them.

// After deploying the version with folders and custom sizes: fills each project's width and height from its
// timeline wherever the version live during the deploy left them empty or out of date. Safe to run again.
export const REFILL_PROJECT_SIZES =
  "update projects set width = (doc->>'width')::integer, height = (doc->>'height')::integer where width is distinct from (doc->>'width')::integer or height is distinct from (doc->>'height')::integer;";

// Before promoting an earlier version, which cannot read the custom format, and once more right after: labels each
// custom project Landscape 16:9 in its timeline too, keeping its size and clips, so the earlier version's writes keep that label.
export const BEFORE_GOING_BACK =
  "update projects set format = 'long_16x9', doc = jsonb_set(doc, '{format}', '\"long_16x9\"') where format = 'custom' or doc->>'format' = 'custom';";

// After coming forward again, first: makes custom again each Landscape 16:9 timeline whose size is not 1920 × 1080, which
// only BEFORE_GOING_BACK makes.
export const CUSTOM_AFTER_COMING_FORWARD =
  "update projects set format = 'custom', doc = jsonb_set(doc, '{format}', '\"custom\"') where doc->>'format' = 'long_16x9' and ((doc->>'width')::integer, (doc->>'height')::integer) <> (1920, 1080);";

// Then: puts back each project's format from its timeline.
export const AFTER_COMING_FORWARD = "update projects set format = doc->>'format' where format is distinct from doc->>'format';";
