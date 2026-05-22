// =============================================================================
// server/lib/storage.js
//
// Thin wrapper around Supabase Storage for AI-authored file artefacts.
// Uses the service_role key (already configured in lib/supabase.js) so RLS
// is bypassed on writes. Clients receive signed URLs with a finite lifetime.
//
// Bucket setup (one-time, run in Supabase SQL editor):
//   insert into storage.buckets (id, name, public)
//   values ('generated-files', 'generated-files', false);
//
// =============================================================================

const supabase = require('./supabase');

const BUCKET = 'generated-files';

// 7 days. Long enough that "I'll come back to that doc tomorrow" works
// reliably. Short enough that links don't outlive their usefulness.
const DEFAULT_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

// -----------------------------------------------------------------------------
// Option parsing.
//
// The optional final argument on uploadAndSign / signExistingFile may be:
//   - a number  -> treated as the signed-URL TTL in seconds (legacy callers)
//   - a string  -> treated as the friendly download filename (OUT-6)
//   - an object -> { downloadName | download, expiresInSeconds }
//   - undefined -> defaults
//
// This tolerance means it works no matter which shape copilot.js passes.
// -----------------------------------------------------------------------------
function parseSignOptions(options) {
  let expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS;
  let downloadName = null;

  if (typeof options === 'number') {
    expiresInSeconds = options;
  } else if (typeof options === 'string') {
    downloadName = options;
  } else if (options && typeof options === 'object') {
    if (typeof options.expiresInSeconds === 'number') expiresInSeconds = options.expiresInSeconds;
    if (typeof options.downloadName === 'string') downloadName = options.downloadName;
    if (typeof options.download === 'string') downloadName = options.download;
  }

  // createSignedUrl's options object accepts a `download` field. When a string
  // is supplied, the browser saves the file under that name regardless of the
  // unique storage path.
  const signOptions = downloadName ? { download: downloadName } : undefined;
  return { expiresInSeconds, signOptions };
}

/**
 * Upload a buffer to Supabase Storage and return a signed download URL.
 *
 * @param {Buffer} buffer            The file bytes to upload.
 * @param {string} storagePath       Relative path within the bucket. Convention:
 *                                   `${userId}/${sessionId}/${filename}`.
 * @param {string} contentType       MIME type (e.g. word docx mime).
 * @param {(number|string|object)} [options] TTL in seconds, a friendly download
 *                                   filename, or { downloadName, expiresInSeconds }.
 * @returns {Promise<{ signedUrl: string, storagePath: string }>}
 */
async function uploadAndSign(buffer, storagePath, contentType, options) {
  const { expiresInSeconds, signOptions } = parseSignOptions(options);

  // Upload. upsert: true so retrying the same path overwrites cleanly during
  // development.
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: true });

  if (uploadError) {
    throw new Error('Storage upload failed: ' + uploadError.message);
  }

  // Sign URL.
  const { data, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds, signOptions);

  if (signError) {
    throw new Error('Sign URL failed: ' + signError.message);
  }

  return { signedUrl: data.signedUrl, storagePath };
}

/**
 * Re-sign a file that already exists in the bucket, returning a fresh signed
 * URL (OUT-5). Used when resuming a session so previously generated documents
 * get a working download link even after the original 7-day URL has expired.
 *
 * @param {string} storagePath       Existing path within the bucket.
 * @param {(number|string|object)} [options] TTL in seconds, a friendly download
 *                                   filename, or { downloadName, expiresInSeconds }.
 * @returns {Promise<{ signedUrl: string, storagePath: string }>}
 */
async function signExistingFile(storagePath, options) {
  const { expiresInSeconds, signOptions } = parseSignOptions(options);

  const { data, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds, signOptions);

  if (signError) {
    throw new Error('Sign URL failed: ' + signError.message);
  }

  return { signedUrl: data.signedUrl, storagePath };
}

module.exports = {
  uploadAndSign,
  signExistingFile,
  BUCKET,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
};