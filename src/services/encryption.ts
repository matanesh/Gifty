/**
 * @file encryption.ts
 * @description Encryption service for sensitive gift card fields (code, pin, card_number).
 *
 * ## Strategy
 * - **Algorithm**: AES-256-GCM (authenticated encryption, via Web Crypto API / `crypto.subtle`)
 *   Available in Expo SDK 52+ on Hermes engine — no extra native modules required.
 * - **Key storage**: The master AES key is generated once per device, exported as raw bytes,
 *   and stored in `expo-secure-store` (backed by iOS Keychain / Android Keystore).
 * - **SQLite storage**: Encrypted values are stored as base64-encoded strings with a recognisable
 *   prefix (`enc:v1:`) so we can detect them at read time.
 * - **IV**: A fresh 12-byte IV is generated for every encryption operation and prepended to the
 *   ciphertext before base64-encoding. This is standard practice for GCM.
 *
 * ## Usage
 * ```ts
 * // Encrypt before saving to SQLite:
 * const encryptedPin = await encryptSensitiveField('1234');
 * // → 'enc:v1:<base64(iv + ciphertext)>'
 *
 * // Decrypt when reading from SQLite:
 * const pin = await decryptSensitiveField(card.pin);
 * // → '1234' (or null if the value was null/already plaintext)
 *
 * // Check if a value came from this service:
 * if (isEncryptedValue(card.pin)) { ... }
 *
 * // Delete stored key material when user deletes their account:
 * await deleteEncryptionKey();
 * ```
 *
 * @module encryption
 */

import * as SecureStore from 'expo-secure-store';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Key under which the AES key material is stored in expo-secure-store. */
const MASTER_KEY_STORE_KEY = 'gifty_aes_master_key_v1';

/**
 * Prefix added to every encrypted value before writing to SQLite.
 * Used to distinguish encrypted from plaintext values at read time.
 */
export const ENCRYPTED_VALUE_PREFIX = 'enc:v1:';

/** AES-GCM IV length in bytes (12 bytes = 96 bits — NIST recommended). */
const IV_LENGTH = 12;

// ---------------------------------------------------------------------------
// In-memory cache (avoid SecureStore round-trips in hot paths)
// ---------------------------------------------------------------------------

let cachedKey: CryptoKey | null = null;

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

/**
 * Returns the app-level AES-256-GCM CryptoKey.
 * On first call, generates a new key and persists it in SecureStore.
 * On subsequent calls, retrieves and imports the stored key.
 *
 * @throws {Error} If SecureStore is unavailable (e.g. in unsupported emulator).
 */
async function getMasterKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const storedKey = await SecureStore.getItemAsync(MASTER_KEY_STORE_KEY);

  if (storedKey) {
    // Import existing key
    const keyBytes = base64ToBytes(storedKey);
    cachedKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM', length: 256 },
      false, // not extractable after import (defence in depth)
      ['encrypt', 'decrypt'],
    );
  } else {
    // Generate a new key for this device
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true, // must be extractable to persist it
      ['encrypt', 'decrypt'],
    );

    // Export and persist
    const exported = await crypto.subtle.exportKey('raw', key);
    await SecureStore.setItemAsync(
      MASTER_KEY_STORE_KEY,
      bytesToBase64(new Uint8Array(exported)),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );

    // Re-import as non-extractable (tighten permissions after persistence)
    const keyBytes = new Uint8Array(exported);
    cachedKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  return cachedKey;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypts a sensitive string value using AES-256-GCM.
 * Returns a prefixed base64 string safe to store in SQLite.
 *
 * @param value - Plaintext string to encrypt (e.g. card PIN, code).
 * @returns Promise resolving to an encrypted token: `'enc:v1:<base64>'`.
 *
 * @example
 * const storedPin = await encryptSensitiveField('9876');
 */
export async function encryptSensitiveField(value: string): Promise<string> {
  const key = await getMasterKey();

  // Generate a random 12-byte IV for this encryption operation
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );

  // Prepend IV to ciphertext: [iv (12 bytes)][ciphertext (n bytes)]
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);

  return ENCRYPTED_VALUE_PREFIX + bytesToBase64(combined);
}

/**
 * Decrypts a value previously encrypted by `encryptSensitiveField`.
 * Returns `null` if the input is null, undefined, or not an encrypted token.
 *
 * @param encryptedValue - Value read from SQLite (may or may not be encrypted).
 * @returns The decrypted plaintext string, or `null`.
 *
 * @example
 * const pin = await decryptSensitiveField(card.pin);
 * if (pin) showPin(pin);
 */
export async function decryptSensitiveField(
  encryptedValue: string | null | undefined,
): Promise<string | null> {
  if (!encryptedValue) return null;
  if (!isEncryptedValue(encryptedValue)) {
    // Value exists but wasn't encrypted (e.g. imported legacy data)
    return encryptedValue;
  }

  try {
    const key = await getMasterKey();

    const base64Part = encryptedValue.slice(ENCRYPTED_VALUE_PREFIX.length);
    const combined = base64ToBytes(base64Part);

    if (combined.length <= IV_LENGTH) {
      throw new Error('Encrypted value is too short — possible data corruption.');
    }

    const iv = combined.slice(0, IV_LENGTH);
    const ciphertext = combined.slice(IV_LENGTH);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(plaintext);
  } catch (err) {
    // Log but don't throw — return null so the app degrades gracefully
    console.error('[Gifty/encryption] Failed to decrypt field:', err);
    return null;
  }
}

/**
 * Returns `true` if the value looks like an output of `encryptSensitiveField`.
 *
 * @param value - Any string from the database.
 */
export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_VALUE_PREFIX);
}

/**
 * Re-encrypts a card's sensitive fields if they are currently stored as plaintext.
 * Useful for migrating legacy data that was entered before encryption was in place.
 *
 * @param fields - Object with optional `code`, `pin`, `card_number` string values.
 * @returns Same shape with encrypted values where applicable.
 */
export async function encryptCardFields(fields: {
  code?: string | null;
  pin?: string | null;
  card_number?: string | null;
}): Promise<{
  code: string | null;
  pin: string | null;
  card_number: string | null;
}> {
  const [code, pin, card_number] = await Promise.all([
    fields.code && !isEncryptedValue(fields.code)
      ? encryptSensitiveField(fields.code)
      : Promise.resolve(fields.code ?? null),

    fields.pin && !isEncryptedValue(fields.pin)
      ? encryptSensitiveField(fields.pin)
      : Promise.resolve(fields.pin ?? null),

    fields.card_number && !isEncryptedValue(fields.card_number)
      ? encryptSensitiveField(fields.card_number)
      : Promise.resolve(fields.card_number ?? null),
  ]);

  return { code, pin, card_number };
}

/**
 * Decrypts all sensitive card fields at once.
 *
 * @param fields - Object with potentially encrypted `code`, `pin`, `card_number`.
 * @returns Same shape with decrypted values (null for absent or corrupt fields).
 */
export async function decryptCardFields(fields: {
  code: string | null;
  pin: string | null;
  card_number: string | null;
}): Promise<{
  code: string | null;
  pin: string | null;
  card_number: string | null;
}> {
  const [code, pin, card_number] = await Promise.all([
    decryptSensitiveField(fields.code),
    decryptSensitiveField(fields.pin),
    decryptSensitiveField(fields.card_number),
  ]);

  return { code, pin, card_number };
}

/**
 * Deletes the master encryption key from SecureStore and clears the in-memory cache.
 * ⚠️ WARNING: After calling this, all previously encrypted values are PERMANENTLY
 * unrecoverable. Only call this during account deletion.
 */
export async function deleteEncryptionKey(): Promise<void> {
  cachedKey = null;
  await SecureStore.deleteItemAsync(MASTER_KEY_STORE_KEY);
}

/**
 * Checks whether a valid master key exists in SecureStore (i.e. the user has
 * set up encryption on this device before).
 */
export async function hasEncryptionKey(): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(MASTER_KEY_STORE_KEY);
  return stored !== null;
}

// ---------------------------------------------------------------------------
// Base64 utilities (no external deps)
// ---------------------------------------------------------------------------

/**
 * Converts a Uint8Array to a base64 string.
 * Uses `btoa` which is available in both browser and Hermes (RN 0.71+).
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts a base64 string back to a Uint8Array.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
