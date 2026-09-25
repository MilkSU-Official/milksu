import { describe, expect, it } from 'vitest'
import { withAppSettingsDefaults } from '@/types'

// 6c-2（前端半）：紧急开关的归一化语义。
// 读者硬要求：**缺省与 false 都不得关闭保护** ✗（静默失守比拦得住更糟）；只有显式 true 才算关 ✓。
describe('agent_protection_disabled 归一化', () => {
  it('缺省（未出现）⇒ 保护生效', () => {
    expect(withAppSettingsDefaults({}).agent_protection_disabled).toBe(false)
  })

  it('显式 false ⇒ 保护生效', () => {
    expect(withAppSettingsDefaults({ agent_protection_disabled: false }).agent_protection_disabled).toBe(false)
  })

  it('显式 true ⇒ 关闭整套保护', () => {
    expect(withAppSettingsDefaults({ agent_protection_disabled: true }).agent_protection_disabled).toBe(true)
  })

  it('脏值（字符串/数字/对象）一律当作保护生效（只有显式 true 才算关 ✓）', () => {
    for (const dirty of ['true', 1, {}, []]) {
      expect(withAppSettingsDefaults({ agent_protection_disabled: dirty } as never).agent_protection_disabled).toBe(false)
    }
  })
})
