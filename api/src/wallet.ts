import * as crypto from 'crypto'
import { ethers } from 'ethers'

// AES-256-GCM is authenticated encryption — the auth tag lets us detect
// any tampering with the stored ciphertext before decryption.
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12   // 96-bit IV is the recommended GCM size
const TAG_BYTES = 16  // 128-bit authentication tag (GCM default)

// -------------------------------------------------------------------
// Key derivation
// -------------------------------------------------------------------

function getEncryptionKey(): Buffer {
  const hex = process.env.WALLET_ENCRYPTION_KEY
  if (!hex) {
    throw new Error('WALLET_ENCRYPTION_KEY is not set in environment')
  }
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) {
    throw new Error(
      `WALLET_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars), got ${key.length} bytes`,
    )
  }
  return key
}

// -------------------------------------------------------------------
// Encryption / decryption
// -------------------------------------------------------------------

// Stores the encrypted result as "iv:authTag:ciphertext" (all hex-encoded)
// so the three components needed for decryption travel together.
export function encryptPrivateKey(privateKey: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const ciphertext = Buffer.concat([
    cipher.update(privateKey, 'utf-8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    ciphertext.toString('hex'),
  ].join(':')
}

export function decryptPrivateKey(encrypted: string): string {
  const key = getEncryptionKey()
  const parts = encrypted.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted private key format')
  }
  const [ivHex, authTagHex, ciphertextHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')

  if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES) {
    throw new Error('Corrupted encrypted private key: invalid IV or auth tag length')
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf-8')
}

// -------------------------------------------------------------------
// Wallet generation
// -------------------------------------------------------------------

export interface GeneratedWallet {
  address: string
  privateKey: string
  encryptedPrivateKey: string
}

export function generateWallet(): GeneratedWallet {
  const wallet = ethers.Wallet.createRandom()
  const privateKey = wallet.privateKey
  return {
    address: wallet.address,
    privateKey,
    encryptedPrivateKey: encryptPrivateKey(privateKey),
  }
}

// -------------------------------------------------------------------
// Wallet rehydration from storage
// -------------------------------------------------------------------

export function walletFromEncrypted(
  encryptedPrivateKey: string,
  provider: ethers.Provider,
): ethers.Wallet {
  const privateKey = decryptPrivateKey(encryptedPrivateKey)
  return new ethers.Wallet(privateKey, provider)
}
