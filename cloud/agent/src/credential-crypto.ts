/**
 * AES-GCM helpers for cloud BYOK (CREDENTIAL_KEK secret).
 * Mature Web Crypto shape used across Workers examples — never log plaintext.
 */

function b64Encode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i])
  return btoa(binary)
}

function b64Decode(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

async function importKek(raw: string): Promise<CryptoKey> {
  const trimmed = String(raw || '').trim()
  if (!trimmed) throw new Error('CREDENTIAL_KEK missing')
  // Accept raw base64 (32 bytes) or utf8 passphrase stretched via SHA-256.
  let material: Uint8Array
  try {
    const decoded = b64Decode(trimmed)
    material = decoded.byteLength === 32 ? decoded : new Uint8Array(await crypto.subtle.digest('SHA-256', decoded))
  } catch {
    material = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(trimmed)))
  }
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptCredentialSecret(
  kek: string,
  plaintext: string,
): Promise<{ iv_b64: string; ciphertext_b64: string }> {
  const key = await importKek(kek)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    iv_b64: b64Encode(iv),
    ciphertext_b64: b64Encode(ciphertext),
  }
}

export async function decryptCredentialSecret(
  kek: string,
  iv_b64: string,
  ciphertext_b64: string,
): Promise<string> {
  const key = await importKek(kek)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64Decode(iv_b64) },
    key,
    b64Decode(ciphertext_b64),
  )
  return new TextDecoder().decode(plain)
}
