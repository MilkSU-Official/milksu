'use strict'

const path = require('node:path')

function rendererMimeType(file) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  })[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

function rendererHeaders(file) {
  return {
    'cache-control': 'no-store',
    'content-type': rendererMimeType(file),
    'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'",
    'x-content-type-options': 'nosniff',
  }
}

module.exports = { rendererHeaders, rendererMimeType }
