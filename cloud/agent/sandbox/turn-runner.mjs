#!/usr/bin/env node
/**
 * One-shot cloud turn runner inside the CF Sandbox container.
 * Worker calls this via sandbox.exec / execStream with JSON on stdin
 * (https://developers.cloudflare.com/sandbox/api/commands/ — stdin avoids shell injection).
 *
 * Replace the body with Pi bridge / DSH ACP once milksu-admin attaches those binaries.
 */
async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { text: raw }
  }
}

async function main() {
  const input = await readStdin()
  const kernel = String(process.env.MILKSU_CLOUD_KERNEL || 'pi').trim() || 'pi'
  const text = String(input.text || '').trim()
  const turnId = String(input.turn_id || '')
  // Placeholder output until the real harness is wired.
  const reply = text
    ? `[${kernel}] cloud turn accepted (${turnId || 'no-id'}). Pi/DSH bridge not attached yet.`
    : `[${kernel}] cloud sandbox ready. Pi/DSH bridge not attached yet.`
  process.stdout.write(reply)
  process.stdout.write('\n')
}

main().catch(error => {
  console.error(String(error?.stack || error))
  process.exit(1)
})
