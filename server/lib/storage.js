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

/**
 * Upload a buffer to Supabase Storage and return a signed download URL.
 *
 * @param {Buffer} buffer            The file bytes to upload.
 * @param {string} storagePath       Relative path within the bucket. Convention:
 *                                   `${userId}/${sessionId}/${filename}`.
 * @param {string} contentType       MIME type (e.g. word docx mime).
 * @param {number} [expiresInSeconds] Signed URL TTL. Defaults to 7 days.
 * @returns {Promise<{ signedUrl: string, storagePath: string }>}
 */
async function uploadAndSign(
  buffer,
  storagePath,
  contentType,
  expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS
) {
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
    .createSignedUrl(storagePath, expiresInSeconds);

  if (signError) {
    throw new Error('Sign URL failed: ' + signError.message);
  }

  return { signedUrl: data.signedUrl, storagePath };
}

module.exports = { uploadAndSign, BUCKET, DEFAULT_SIGNED_URL_TTL_SECONDS };
