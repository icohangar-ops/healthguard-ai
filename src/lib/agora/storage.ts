/**
 * Shared object-storage config for Cloud Recording and persisted transcripts.
 *
 * Validated before any Agora acquire/join so a bad vendor/region integer cannot
 * consume a single-use resource id and then fail.
 */
export function agoraStorageConfig(fileNamePrefix: readonly string[]): Record<string, unknown> {
  const required = [
    "AGORA_STORAGE_VENDOR",
    "AGORA_STORAGE_REGION",
    "AGORA_STORAGE_BUCKET",
    "AGORA_STORAGE_ACCESS_KEY",
    "AGORA_STORAGE_SECRET_KEY",
  ] as const;
  const missing = required.filter((name) => (process.env[name] ?? "").trim() === "");
  if (missing.length > 0) {
    throw new Error(`object storage needs: ${missing.join(", ")}`);
  }

  const vendor = Number(process.env.AGORA_STORAGE_VENDOR);
  const region = Number(process.env.AGORA_STORAGE_REGION);
  if (!Number.isInteger(vendor) || !Number.isInteger(region)) {
    throw new Error("AGORA_STORAGE_VENDOR and AGORA_STORAGE_REGION must be integers");
  }

  return {
    vendor,
    region,
    bucket: process.env.AGORA_STORAGE_BUCKET,
    accessKey: process.env.AGORA_STORAGE_ACCESS_KEY,
    secretKey: process.env.AGORA_STORAGE_SECRET_KEY,
    fileNamePrefix: [...fileNamePrefix],
  };
}
