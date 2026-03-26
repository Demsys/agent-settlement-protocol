"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptPrivateKey = encryptPrivateKey;
exports.decryptPrivateKey = decryptPrivateKey;
exports.generateWallet = generateWallet;
exports.walletFromEncrypted = walletFromEncrypted;
const crypto = __importStar(require("crypto"));
const ethers_1 = require("ethers");
// AES-256-GCM is authenticated encryption — the auth tag lets us detect
// any tampering with the stored ciphertext before decryption.
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV is the recommended GCM size
const TAG_BYTES = 16; // 128-bit authentication tag (GCM default)
// -------------------------------------------------------------------
// Key derivation
// -------------------------------------------------------------------
function getEncryptionKey() {
    const hex = process.env.WALLET_ENCRYPTION_KEY;
    if (!hex) {
        throw new Error('WALLET_ENCRYPTION_KEY is not set in environment');
    }
    const key = Buffer.from(hex, 'hex');
    if (key.length !== 32) {
        throw new Error(`WALLET_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars), got ${key.length} bytes`);
    }
    return key;
}
// -------------------------------------------------------------------
// Encryption / decryption
// -------------------------------------------------------------------
// Stores the encrypted result as "iv:authTag:ciphertext" (all hex-encoded)
// so the three components needed for decryption travel together.
function encryptPrivateKey(privateKey) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(privateKey, 'utf-8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
        iv.toString('hex'),
        authTag.toString('hex'),
        ciphertext.toString('hex'),
    ].join(':');
}
function decryptPrivateKey(encrypted) {
    const key = getEncryptionKey();
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted private key format');
    }
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES) {
        throw new Error('Corrupted encrypted private key: invalid IV or auth tag length');
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]).toString('utf-8');
}
function generateWallet() {
    const wallet = ethers_1.ethers.Wallet.createRandom();
    const privateKey = wallet.privateKey;
    return {
        address: wallet.address,
        privateKey,
        encryptedPrivateKey: encryptPrivateKey(privateKey),
    };
}
// -------------------------------------------------------------------
// Wallet rehydration from storage
// -------------------------------------------------------------------
function walletFromEncrypted(encryptedPrivateKey, provider) {
    const privateKey = decryptPrivateKey(encryptedPrivateKey);
    return new ethers_1.ethers.Wallet(privateKey, provider);
}
//# sourceMappingURL=wallet.js.map