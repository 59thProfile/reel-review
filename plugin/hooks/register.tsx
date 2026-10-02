import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, Decision, RunInfo } from '../types'

const PANE = 'reel-review'

const cards = atom({ plugin: 'reel-review', key: 'cards' } as const, [] as Card[])
const decisions = atom({ plugin: 'reel-review', key: 'decisions' } as const, {} as Record<string, Decision>)
const index = atom({ plugin: 'reel-review', key: 'index' } as const, 0)
const isRunning = atom({ plugin: 'reel-review', key: 'isRunning' } as const, false)
const runInfo = atom({ plugin: 'reel-review', key: 'run' } as const, null as RunInfo)
const error = atom({ plugin: 'reel-review', key: 'error' } as const, null as string | null)

/** The cards still waiting on a decision: every non-passing card not yet sent or approved. */
export function queueOf(all: Card[], decided: Record<string, Decision>): Card[] {
  return all.filter(c => c.verdict !== 'pass' && decided[c.id] === undefined)
}

/** The prompt a left swipe hands to Claude. */
export function promptFor(card: Card, app: string): string {
  const lines = [
    `A reel test of ${app} needs a fix.`,
    ``,
    `${card.kind === 'flow' ? 'Flow' : 'Screen'}: ${card.title}${card.url ? ` (${card.url})` : ''}`,
  ]
  if (card.intent) lines.push(`What it checks: ${card.intent}`)
  if (card.step) lines.push(`Failing step: ${card.step}`)
  if (card.expected !== null || card.actual !== null) {
    lines.push(`Expected: ${card.expected ?? '(none)'}`, `Actual: ${card.actual ?? '(none)'}`)
  }
  if (card.shot) lines.push(`Screenshot at the failure: ${card.shot}`)
  if (card.diff) lines.push(`Pixel diff against the approved baseline: ${card.diff}`)
  lines.push(
    ``,
    `Read the screenshot(s), find the cause in this codebase and fix it. ` +
      `If the app is right and the test or baseline is what's stale, say so instead of changing the app. ` +
      `When done, run /reels run to re-check.`,
  )
  return lines.join('\n')
}

const config = { pipelineDir: '', runOnCommit: true }

async function load($: EngineInterface) {
  const text = await $.fs.read(`${config.pipelineDir}/.reels/cards.json`)
  const data = JSON.parse(text) as { ranAt: string; app: string; cards: Card[] }
  await update($, cards, () => data.cards)
  await update($, runInfo, () => ({ ranAt: data.ranAt, app: data.app }))
  await update($, decisions, () => ({}))
  await update($, index, () => 0)
  const waiting = queueOf(data.cards, {}).length
  $.ui.status(waiting === 0 ? 'reels: all green' : `reels: ${waiting} to review`)
  return waiting
}

async function runReels($: EngineInterface) {
  if (!config.pipelineDir) {
    await update($, error, () => 'Set "Reel runner folder" in /config (reel-review) first.')
    return
  }
  if (await read($, isRunning)) return
  await update($, isRunning, () => true)
  await update($, error, () => null)
  $.ui.status('reels: running…')
  try {
    const done = await $.process.run(['node', 'reel.mjs', 'run'], { cwd: config.pipelineDir, timeoutMs: 600_000 })
    if (done.exitCode !== 0) {
      await update($, error, () => (done.stderr.trim().split('\n').slice(-3).join('\n') || `reel.mjs exited ${done.exitCode}`))
      $.ui.status('reels: run failed')
    } else {
      const waiting = await load($)
      if (waiting > 0) $.ui.toast(`Reels: ${waiting} to review. /reels to swipe.`)
    }
  } catch (err) {
    await update($, error, () => String(err))
    $.ui.status('reels: run failed')
  } finally {
    await update($, isRunning, () => false)
  }
}

async function decide($: EngineInterface, card: Card, decision: Decision) {
  await update($, decisions, d => ({ ...d, [card.id]: decision }))
  const left = queueOf(await read($, cards), await read($, decisions)).length
  await update($, index, i => Math.min(i, Math.max(0, left - 1)))
  $.ui.status(left === 0 ? 'reels: all reviewed' : `reels: ${left} to review`)
}

async function sendToClaude($: EngineInterface, card: Card) {
  const run = await read($, runInfo)
  await decide($, card, 'sent')
  await $.prompt.submit({ text: promptFor(card, run?.app ?? 'the app') })
}

async function approve($: EngineInterface, card: Card) {
  if (card.kind === 'screen') {
    const route = card.id.slice('screen:'.length)
    const done = await $.process.run(['node', 'reel.mjs', 'approve', route], { cwd: config.pipelineDir })
    if (done.exitCode !== 0) {
      $.ui.toast(`Could not approve ${card.title}: ${done.stderr.trim().slice(0, 120)}`)
      return
    }
  }
  await decide($, card, 'approved')
}

export const register: Register = (on, options) => {
  config.pipelineDir = String(options.pipelineDir ?? '')
  config.runOnCommit = options.runOnCommit !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'reels',
      description: 'Swipe your app\'s reel results (/reels run re-runs them)',
      argumentHint: '[run]',
    })
    if (config.pipelineDir && (await $.fs.exists(`${config.pipelineDir}/.reels/cards.json`))) {
      await load($).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'reels' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'Reels', focus: true })
    if (e.args.trim() === 'run') {
      void runReels($)
      return { text: 'Re-running the reels. Results land in the Reels pane.' }
    }
    return { text: 'Reels pane open. f sends a card to Claude, a approves it, n/p move.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const committed = /\bgit\b[^\n|;&]*\bcommit\b/.test(e.command) && ran.deny === undefined && ran.isError !== true
    if (committed && config.runOnCommit && config.pipelineDir) {
      $.clock.after(0, () => void runReels($))
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, cards)
    const decided = await read($, decisions)
    const queue = queueOf(all, decided)
    const at = Math.min(await read($, index), Math.max(0, queue.length - 1))
    const running = await read($, isRunning)
    const problem = await read($, error)
    const run = await read($, runInfo)
    const passing = all.filter(c => c.verdict === 'pass').length
    const width = Math.max(20, e.props.bodyColumns)

    const header = (
      <Box flexDirection="row">
        <Text bold>{run ? `${run.app}` : 'No reel run yet'}</Text>
        <Text dimColor>
          {run ? `  ${passing} passing · ${queue.length} to review${running ? ' · running…' : ''}` : ''}
        </Text>
      </Box>
    )
    const runButton = (
      <Button key="run" label={running ? 'Running…' : 'Re-run'} hotkey="r" onPress={() => void runReels($)} />
    )

    if (problem) {
      return (
        <Box flexDirection="column">
          {header}
          <Text color="red">{problem}</Text>
          {runButton}
        </Box>
      )
    }

    const card = queue[at]
    if (!card) {
      return (
        <Box flexDirection="column">
          {header}
          <Text color="green">{run ? 'Nothing to review. Every flow and screen matches.' : 'Run the reels to get cards.'}</Text>
          {runButton}
        </Box>
      )
    }

    const tag = card.verdict === 'fail' ? 'FAIL' : 'CHANGED'
    const picture = card.diff ?? card.shot
    const imgCols = Math.min(width, 100)
    const imgRows = Math.max(6, Math.round((imgCols * 800) / 1280 / 2))

    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection="row">
          <Text bold color={card.verdict === 'fail' ? 'red' : 'yellow'}>{tag} </Text>
          <Text bold>{card.title}</Text>
          <Text dimColor>{`  ${at + 1}/${queue.length} · ${card.kind}`}</Text>
        </Box>
        {card.step && <Text>{card.step}</Text>}
        {card.expected !== null && <Text dimColor>{`expected  ${card.expected}`}</Text>}
        {card.actual !== null && <Text>{`actual    ${card.actual}`}</Text>}
        {picture && e.surface === 'terminal' && (() => {
          const { Image } = $.ui.resolve(e as typeof e & { surface: 'terminal' })
          return (
            <Image
              key="shot"
              source={{ file: picture, format: 'png' }}
              columns={imgCols}
              rows={imgRows}
              alt={`Screenshot: ${picture}`}
            />
          )
        })()}
        {picture && e.surface !== 'terminal' && <Text dimColor>{picture}</Text>}
        <Box flexDirection="row">
          <Button key="send" label="Send to Claude" hotkey="f" variant="primary" onPress={() => void sendToClaude($, card)} />
          <Button key="approve" label={card.kind === 'screen' ? 'Approve as baseline' : 'Dismiss'} hotkey="a" onPress={() => void approve($, card)} />
          <Button key="prev" label="Prev" hotkey="p" onPress={() => void update($, index, i => Math.max(0, i - 1))} />
          <Button key="next" label="Next" hotkey="n" onPress={() => void update($, index, i => Math.min(queue.length - 1, i + 1))} />
          {runButton}
        </Box>
      </Box>
    )
  })
}
