<script setup lang="ts">
import { nextTick, ref } from 'vue'

const draft = ref('')
const sent = ref(false)

async function send() {
  if (!draft.value.trim()) {
    draft.value = '先帮我分析程序的整体流程和关键校验点。'
  }
  sent.value = true
  await nextTick()
  document.getElementById('study-composer-input')?.blur()
}
</script>

<template>
  <div style="display:grid;min-height:100%;grid-template-rows:auto 1fr auto">
    <p class="study-context">
      来源 <strong>CTF · EZ_UDS_PLUS</strong>
      · 目标 <strong>分析程序逻辑，找出正确输入</strong>
      · <button type="button" class="ak-button ak-button--outline" style="width:auto;height:2rem;padding:0 .8rem;font-size:.75rem">返回挑战</button>
    </p>

    <div class="study-thread">
      <article class="study-bubble study-bubble--agent">
        <span class="study-bubble__who">MILKSU</span>
        <p>已经读过 EZ_UDS_PLUS 的题面和附件。下一步可以先拆调用链，也可以直接对着校验函数下手。</p>
      </article>
      <p class="study-tool">read · challenge.zip · 完成</p>
      <article class="study-bubble study-bubble--user">
        <span class="study-bubble__who">YOU</span>
        <p>先帮我分析程序的整体流程和关键校验点。</p>
      </article>
      <article v-if="sent" class="study-bubble study-bubble--agent">
        <span class="study-bubble__who">DRAFT</span>
        <p>这条消息只存在于预览里，用来确认输入区才是这一页的重心。</p>
      </article>
    </div>

    <form class="study-composer" @submit.prevent="send">
      <label class="ak-field" style="margin:0">
        <span class="ak-label">下一条指令</span>
        <textarea
          id="study-composer-input"
          v-model="draft"
          class="ak-textarea"
          rows="3"
          placeholder="描述你想让 MilkSU 完成的任务"
        />
      </label>
      <button type="submit" class="ak-button ak-button--action">
        <span class="ak-button__label">发送</span>
      </button>
    </form>
  </div>
</template>
