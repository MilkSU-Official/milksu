import { useEffect, useMemo, useRef, useState } from 'react'
import { latestCodingPlan, settleIdleCodingPlan, type CodingPlanStep } from '@/lib/codingPlan'
import { useT } from '@/hooks/useUiLocale'
import type { Message } from '@/types'

const RING = 24
const STROKE = 2
const ringRadius = (RING - STROKE) / 2
const ringCircumference = 2 * Math.PI * ringRadius
const ringDash = `${ringCircumference * 0.28} ${ringCircumference * 0.72}`
const AUTO_HIDE_MS = 4_000

function PlanRing({
  status,
  index,
}: {
  status: CodingPlanStep['status']
  index: number
}) {
  if (status === 'completed') {
    return (
      <span className="agent-task-badge__done">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
    )
  }
  return (
    <span className={`agent-task-ring${status === 'in_progress' ? ' agent-task-ring--active' : ''}`}>
      <svg width={RING} height={RING} className="agent-task-ring__svg" aria-hidden="true">
        <circle
          cx={RING / 2}
          cy={RING / 2}
          r={ringRadius}
          fill="none"
          stroke="currentColor"
          className="agent-task-ring__track"
          strokeWidth={STROKE}
        />
        {status === 'in_progress' ? (
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={ringRadius}
            fill="none"
            stroke="currentColor"
            className="agent-task-ring__arc"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={ringDash}
          />
        ) : null}
      </svg>
      <span className="agent-task-ring__index">{index + 1}</span>
    </span>
  )
}

export default function AgentExecutionPlan({
  messages,
  running = false,
}: {
  messages: Message[]
  running?: boolean
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const autoHideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sawRunning = useRef(running)
  const [visible, setVisible] = useState(running)

  const currentTurnMessages = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') return messages.slice(index + 1)
    }
    return messages
  }, [messages])

  const plan = useMemo(() => {
    const current = latestCodingPlan(currentTurnMessages)
    if (!current) return null
    return running ? current : settleIdleCodingPlan(current)
  }, [currentTurnMessages, running])

  const planKey = useMemo(() => {
    const current = latestCodingPlan(currentTurnMessages)
    if (!current) return ''
    return `${current.summary}\u0000${current.steps.map(step => `${step.status}:${step.text}`).join('\u0001')}`
  }, [currentTurnMessages])

  function clearAutoHide() {
    if (autoHideTimer.current !== undefined) {
      clearTimeout(autoHideTimer.current)
      autoHideTimer.current = undefined
    }
  }

  useEffect(() => {
    if (running) {
      sawRunning.current = true
      clearAutoHide()
      setVisible(true)
      return
    }
    if (!sawRunning.current) return
    clearAutoHide()
    autoHideTimer.current = setTimeout(() => {
      autoHideTimer.current = undefined
      setVisible(false)
    }, AUTO_HIDE_MS)
    return clearAutoHide
  }, [running])

  useEffect(() => {
    if (!planKey) return
    clearAutoHide()
    setVisible(true)
  }, [planKey])

  useEffect(() => () => {
    clearAutoHide()
    if (closeTimer.current !== undefined) clearTimeout(closeTimer.current)
  }, [])

  const headlineStatus = useMemo<CodingPlanStep['status']>(() => {
    if (!plan) return 'pending'
    if (plan.steps.some(step => step.status === 'in_progress')) return 'in_progress'
    if (plan.steps.every(step => step.status === 'completed')) return 'completed'
    return 'pending'
  }, [plan])

  const headlineIndex = useMemo(() => {
    if (!plan) return 0
    const active = plan.steps.findIndex(step => (
      step.status === 'in_progress' || step.status === 'pending'
    ))
    return active >= 0 ? active : Math.max(0, plan.steps.length - 1)
  }, [plan])

  function statusLabel(status: CodingPlanStep['status']) {
    if (status === 'completed') return t('已完成', 'Completed')
    if (status === 'in_progress') return t('进行中', 'In progress')
    return t('待开始', 'Not started')
  }

  function open() {
    if (closeTimer.current !== undefined) clearTimeout(closeTimer.current)
    setExpanded(true)
  }

  function close() {
    closeTimer.current = setTimeout(() => {
      setExpanded(false)
    }, 180)
  }

  function toggle() {
    if (closeTimer.current !== undefined) clearTimeout(closeTimer.current)
    setExpanded(current => !current)
  }

  if (!plan || !visible) return null

  return (
    <section
      className="agent-task-rows"
      aria-label={t('执行计划', 'Execution plan')}
      data-testid="agent-execution-plan"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocusCapture={open}
      onBlur={close}
    >
      <div className="agent-task-row" data-open={expanded ? 'true' : 'false'}>
        <button
          type="button"
          className="agent-task-row__head"
          aria-expanded={expanded}
          title={plan.summary}
          onClick={event => {
            event.stopPropagation()
            toggle()
          }}
        >
          <span className="agent-task-badge">
            <PlanRing status={headlineStatus} index={headlineIndex} />
          </span>
          <span className="agent-task-row__label" title={plan.summary}>
            {t(`第 ${headlineIndex + 1} / ${plan.steps.length} 步`, `Step ${headlineIndex + 1} / ${plan.steps.length}`)}
          </span>
        </button>
      </div>

      <div className="agent-task-rows__more" data-open={expanded ? 'true' : 'false'}>
        <div className="agent-task-rows__more-inner">
          {plan.steps.map((step, index) => (
            <div
              key={`${index}:${step.text}`}
              className="agent-task-row agent-task-row--child"
              style={{ animationDelay: `${80 + index * 80}ms` }}
            >
              <div className="agent-task-row__head">
                <span className="agent-task-badge">
                  <PlanRing status={step.status} index={index} />
                </span>
                <span className="agent-task-row__label">{step.text}</span>
                {step.status === 'completed' ? (
                  <span className="agent-task-pill agent-task-pill--ok">{statusLabel(step.status)}</span>
                ) : step.status === 'in_progress' ? (
                  <span className="agent-task-row__amount">{statusLabel(step.status)}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
