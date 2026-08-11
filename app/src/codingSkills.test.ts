import { describe, expect, it } from 'vitest'
import { CODING_SKILLS, enabledCodingSkillNames } from './codingSkills'

describe('Coding Skills catalog', () => {
  it('keeps reviewed names unique and filters disabled entries', () => {
    const names = CODING_SKILLS.map(skill => skill.name)
    expect(new Set(names).size).toBe(names.length)
    expect(enabledCodingSkillNames(['product-design', 'archify']))
      .toEqual(names.filter(name => name !== 'product-design' && name !== 'archify'))
  })
})
