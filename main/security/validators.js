// ─────────────────────────────────────────────────────────────────────────────
// CT-desk  ·  Security Validators
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const path = require('path');

/**
 * Validate a file path to prevent path traversal and command injection.
 * @param {string} filePath
 * @throws {Error}
 */
function validateFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('File path must be a non-empty string');
  }

  if (filePath.length > 1024) {
    throw new Error('File path is too long');
  }

  // Block null bytes (command injection vector)
  if (filePath.includes('\0')) {
    throw new Error('File path contains null bytes');
  }

  // Block shell metacharacters
  const dangerousChars = /[;|&`$(){}[\]!<>]/;
  if (dangerousChars.test(filePath)) {
    throw new Error('File path contains disallowed characters');
  }

  // Normalize and check for path traversal
  const normalized = path.normalize(filePath);
  if (normalized.includes('..')) {
    throw new Error('Path traversal detected');
  }

  return normalized;
}

/**
 * Validate a URL.
 * @param {string} url
 * @throws {Error}
 */
function validateUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('URL must be a non-empty string');
  }

  if (url.length > 4096) {
    throw new Error('URL is too long');
  }

  // Block null bytes
  if (url.includes('\0')) {
    throw new Error('URL contains null bytes');
  }

  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Protocol "${parsed.protocol}" is not allowed. Use http: or https:`);
    }
  } catch (e) {
    if (e.message.includes('not allowed')) throw e;
    throw new Error('Invalid URL format');
  }

  return url;
}

/**
 * Validate a numeric value.
 * @param {any} value
 * @param {string} name
 * @param {{ min?: number, max?: number }} options
 * @throws {Error}
 */
function validateNumber(value, name = 'value', options = {}) {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new Error(`${name} must be a valid number`);
  }

  if (options.min !== undefined && value < options.min) {
    throw new Error(`${name} must be >= ${options.min}`);
  }

  if (options.max !== undefined && value > options.max) {
    throw new Error(`${name} must be <= ${options.max}`);
  }

  return value;
}

/**
 * Validate a string value.
 * @param {any} value
 * @param {string} name
 * @param {{ maxLength?: number, pattern?: RegExp }} options
 * @throws {Error}
 */
function validateString(value, name = 'value', options = {}) {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }

  if (options.maxLength && value.length > options.maxLength) {
    throw new Error(`${name} exceeds maximum length of ${options.maxLength}`);
  }

  if (options.pattern && !options.pattern.test(value)) {
    throw new Error(`${name} has invalid format`);
  }

  return value;
}

module.exports = {
  validateFilePath,
  validateUrl,
  validateNumber,
  validateString,
};
