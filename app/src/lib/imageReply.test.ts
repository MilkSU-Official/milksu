import { describe, expect, it } from 'vitest'
import {
  captionBesideGeneratedImages,
  imageOutputFromToolMessage,
  safeGeneratedImagePath,
} from '@/lib/imageReply'
import type { Message } from '@/types'

function tool(content: string, extra: Partial<Message> = {}): Message {
  return {
    id: 'image-result',
    role: 'tool',
    content,
    timestamp: 1,
    status: 'done',
    toolName: 'milksu_imagegen',
    ...extra,
  }
}

describe('image reply projection', () => {
  it('keeps a workspace image path and rejects escapes', () => {
    expect(safeGeneratedImagePath('milk-cat.png')).toBe('milk-cat.png')
    expect(safeGeneratedImagePath('assets/hero.jpg')).toBe('assets/hero.jpg')
    expect(safeGeneratedImagePath('/tmp/milk-cat.png')).toBe('')
    expect(safeGeneratedImagePath('../milk-cat.png')).toBe('')
    expect(safeGeneratedImagePath('notes.md')).toBe('')
  })

  it('reads a completed ImageGen receipt and ignores a running or failed call', () => {
    expect(imageOutputFromToolMessage(tool(JSON.stringify({
      schema: 'milksu-imagegen-receipt/v1',
      status: 'completed',
      output: { path: 'milk-cat.png', mediaType: 'image/png' },
    })))).toEqual({ id: 'image-result', path: 'milk-cat.png' })
    expect(imageOutputFromToolMessage(tool('MilkSU ImageGen failed', { status: 'done' }))).toBeNull()
    expect(imageOutputFromToolMessage(tool(JSON.stringify({
      status: 'completed',
      output: { path: 'milk-cat.png' },
    }), { status: 'running' }))).toBeNull()
    expect(imageOutputFromToolMessage(tool(JSON.stringify({
      status: 'completed',
      output: { path: 'milk-cat.png' },
    }), { toolName: 'write' }))).toBeNull()
  })

  it('hides a delivery note and keeps a real caption', () => {
    const receipt = [
      '已生成完成。',
      '• 文件： /Users/example/milk-cat.png',
      '• 模型： openai-image/gpt-image-2（Provider: tokenflux）',
      '• 规格： PNG, 1254×1254, 2,091,405 字节',
      '• SHA-256： 5040047063855dec7c41620279e5a8f34b5dc4651c02c697893e5f7d958f881e',
      '• 提示词（用户原文）：画个牛奶猫',
      '工作区内是新建的 .png ，未覆盖任何已有文件，也未改动代码。',
    ].join('\n')
    expect(captionBesideGeneratedImages(receipt, ['milk-cat.png'])).toBe('')
    expect(captionBesideGeneratedImages('猫戴着一顶牛奶帽。', ['milk-cat.png']))
      .toBe('猫戴着一顶牛奶帽。')
    expect(captionBesideGeneratedImages(`${receipt}\n\n猫戴着一顶牛奶帽。`, ['milk-cat.png']))
      .toBe('猫戴着一顶牛奶帽。')
    expect(captionBesideGeneratedImages('先说说这只猫。', [])).toBe('先说说这只猫。')
  })
})
