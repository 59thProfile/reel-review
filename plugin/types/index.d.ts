export type Verdict = 'pass' | 'fail' | 'changed'

export type Card = {
  id: string
  kind: 'flow' | 'screen'
  title: string
  intent: string | null
  url: string | null
  verdict: Verdict
  step: string | null
  expected: string | null
  actual: string | null
  shot: string | null
  diff: string | null
}

export type Decision = 'sent' | 'approved'

export type RunInfo = { ranAt: string; app: string } | null

declare module 'claude-code' {
  interface PluginState {
    'reel-review': {
      cards: Card[]
      decisions: Record<string, Decision>
      index: number
      isRunning: boolean
      run: RunInfo
      error: string | null
    }
  }
}
