import * as crypto from 'crypto'
import { ethers } from 'ethers'

// AES-256-GCM is authenticated encryption — the auth tag lets us detect
// any tampering with the stored ciphertext before decryption.
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES  = 12  // 96-bit IV is the recommended GCM size
const TAG_BYTES = 16  // 128-bit authentication tag (GCM default)

// -------------------------------------------------------------------
// Key derivation
// -------------------------------------------------------------------

function getMasterKey(): Buffer {
  const hex = process.env.WALLET_ENCRYPTION_KEY
  if (!hex) throw new Error('WALLET_ENCRYPTION_KEY is not set in environment')
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) {
    throw new Error(
      `WALLET_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars), got ${key.length} bytes`,
    )
  }
  return key
}

/**
 * SECURITY-009: derive a per-agent AES-256 key using HKDF-SHA256.
 *
 * Isolates each agent's encryption key from the master key. A compromise of
 * one agent's decrypted key does not expose any other agent's key — an
 * attacker who obtains the master key still needs to know the agentId to
 * reconstruct the per-agent key, and cannot decrypt all agents in one pass
 * without enumerating every agentId.
 *
 * info = "asp-agent-key-v2" ensures this derivation is domain-separated from
 * any future HKDF usage in the same codebase.
 */
function deriveAgentKey(masterKey: Buffer, agentId: string): Buffer {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    masterKey,
    Buffer.from(agentId, 'utf-8'), // salt = agentId (unique per agent)
    Buffer.from('asp-agent-key-v2', 'utf-8'), // info = domain separator
    32,
  ))
}

// -------------------------------------------------------------------
// Encryption / decryption
// -------------------------------------------------------------------

/**
 * Encrypt a private key for storage.
 *
 * Format v2 (HKDF-derived key, agentId required):
 *   "v2:iv:authTag:ciphertext" (all hex-encoded)
 *
 * The v2 prefix allows decryptPrivateKey to detect format version and
 * select the correct key derivation path during decryption.
 */
export function encryptPrivateKey(privateKey: string, agentId: string): string {
  const masterKey = getMasterKey()
  const key       = deriveAgentKey(masterKey, agentId)
  const iv        = crypto.randomBytes(IV_BYTES)
  const cipher    = crypto.createCipheriv(ALGORITHM, key, iv)

  const ciphertext = Buffer.concat([
    cipher.update(privateKey, 'utf-8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return ['v2', iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':')
}

/**
 * Decrypt a stored private key.
 *
 * Supports two formats for backward-compatible migration:
 *
 *   v1 (legacy): "iv:authTag:ciphertext"
 *     — uses the master AES key directly (no HKDF)
 *     — agentId is ignored for this format
 *
 *   v2 (current): "v2:iv:authTag:ciphertext"
 *     — uses HKDF(master, agentId) as the AES key
 *     — agentId must be provided and must match the one used during encryption
 *
 * New agents always produce v2. Existing agents with v1 keys continue to work
 * transparently until they are re-encrypted (e.g. via a migration script).
 */
export function decryptPrivateKey(encrypted: string, agentId?: string): string {
  const parts = encrypted.split(':')

  let key: Buffer
  let ivHex: string
  let authTagHex: string
  let ciphertextHex: string

  if (parts[0] === 'v2') {
    // v2: HKDF-derived key
    if (parts.length !== 4) throw new Error('Invalid v2 encrypted key format (expected v2:iv:tag:ct)')
    if (!agentId) throw new Error('agentId is required to decrypt a v2 encrypted key')
    key           = deriveAgentKey(getMasterKey(), agentId)
    ;[, ivHex, authTagHex, ciphertextHex] = parts
  } else {
    // v1 legacy: master key used directly
    if (parts.length !== 3) throw new Error('Invalid encrypted private key format')
    key           = getMasterKey()
    ;[ivHex, authTagHex, ciphertextHex] = parts
  }

  const iv         = Buffer.from(ivHex, 'hex')
  const authTag    = Buffer.from(authTagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')

  if (iv.length !== IV_BYTES)   throw new Error('Corrupted encrypted key: invalid IV length')
  if (authTag.length !== TAG_BYTES) throw new Error('Corrupted encrypted key: invalid auth tag length')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
}

// -------------------------------------------------------------------
// Wallet generation
// -------------------------------------------------------------------

export interface GeneratedWallet {
  address: string
  privateKey: string
  encryptedPrivateKey: string
}

export function generateWallet(agentId: string): GeneratedWallet {
  const wallet     = ethers.Wallet.createRandom()
  const privateKey = wallet.privateKey
  return {
    address: wallet.address,
    privateKey,
    encryptedPrivateKey: encryptPrivateKey(privateKey, agentId),
  }
}

// -------------------------------------------------------------------
// Wallet rehydration from storage
// -------------------------------------------------------------------

export function walletFromEncrypted(
  encryptedPrivateKey: string,
  provider: ethers.Provider,
  agentId?: string,
): ethers.Wallet {
  const privateKey = decryptPrivateKey(encryptedPrivateKey, agentId)
  return new ethers.Wallet(privateKey, provider)
}
