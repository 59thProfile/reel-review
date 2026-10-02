import { expect, test } from 'claude-code/testing'

import { promptFor, queueOf } from '../hooks/register'
import type { Card } from '../types'

const DIR = '/work/reel-review/runner'

const flowFail: Card = {
  id: 'flow:add-item', kind: 'flow', title: 'Add an errand', intent: 'Adding an errand updates the counter.',
  url: '/', verdict: 'fail', step: 'The counter reads "1 item left"', expected: '1 item left', actual: '1 items left',
  shot: `${DIR}/.reels/run/f0-s4.png`, diff: null,
}
const screenChanged: Card = {
  id: 'screen:about', kind: 'screen', title: 'About', intent: null, url: '/about', verdict: 'changed',
  step: '1.20% of pixels changed', expected: null, actual: null,
  shot: `${DIR}/.reels/current/about.png`, diff: `${DIR}/.reels/changes/about.diff.png`,
}
const pass: Card = { ...screenChanged, id: 'screen:home', title: 'Home', verdict: 'pass', step: null, diff: null }
const CARDS = JSON.stringify({ ranAt: '2026-10-02T15:00:00Z', app: 'Errands (example)', cards: [flowFail, screenChanged, pass] })
const PANE_PROPS = { title: 'Reels', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

test('the queue holds only undecided, non-passing cards', async () => {
  expect(queueOf([flowFail, screenChanged, pass], {}).map(c => c.id)).toEqual(['flow:add-item', 'screen:about'])
  expect(queueOf([flowFail, screenChanged, pass], { 'flow:add-item': 'sent' }).map(c => c.id)).toEqual(['screen:about'])
})

test('the prompt carries the failing step, expected vs actual and the screenshot path', async () => {
  const text = promptFor(flowFail, 'Errands (example)')
  expect(text).toContain('Failing step: The counter reads "1 item left"')
  expect(text).toContain('Expected: 1 item left')
  expect(text).toContain('Actual: 1 items left')
  expect(text).toContain(`${DIR}/.reels/run/f0-s4.png`)
})

test('/reels run loads cards; f sends the first to Claude; a approves a screen as baseline', { options: { pipelineDir: DIR, runOnCommit: true } }, async ($, on) => {
  const runs: string[][] = []
  const prompts: string[] = []
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', () => ({ value: CARDS }))
  on('fs.exists', () => ({ value: false }))
  on('ui.open', () => ({ value: {} }) as never)
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })

  await $.command.run({ command: 'reels', args: 'run' } as never)
  // the run is started without awaiting; let it settle
  const later = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout
  const tick = () => new Promise<void>(r => later(r, 5))
  for (let i = 0; i < 40; i++) await tick()
  expect(runs[0]).toEqual(['node', 'reel.mjs', 'run'])

  const term = await $.ui.mount({ plugin: 'reel-review', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'reel-review' })
  expect((await term.find({ type: 'Image' }))).toBeDefined()
  await term.unmount()

  const ui = await $.ui.mount({ plugin: 'reel-review', surface: 'desktop', component: 'Pane', props: PANE_PROPS as never, requestId: 'reel-review' })
  expect((await ui.find({ text: 'Add an errand' }))).toBeDefined()
  expect((await ui.find({ text: /2 to review/ }))).toBeDefined()

  await ui.press({ key: 'send' })
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('Actual: 1 items left')

  expect((await ui.find({ text: 'About' }))).toBeDefined()
  await ui.press({ key: 'approve' })
  expect(runs.at(-1)).toEqual(['node', 'reel.mjs', 'approve', 'about'])
  expect((await ui.find({ text: /Nothing to review/ }))).toBeDefined()
})
