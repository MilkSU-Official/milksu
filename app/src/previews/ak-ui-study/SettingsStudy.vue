<script setup lang="ts">
import { ref } from 'vue'

type Section = 'general' | 'models' | 'account'
const section = ref<Section>('general')
const language = ref('zh-CN')
const opened = ref(false)
</script>

<template>
  <div class="study-settings">
    <nav class="study-settings__nav" aria-label="设置分类">
      <div class="ak-tabs" style="width:100%">
        <div class="ak-tabs__list" style="grid-auto-flow:row">
          <button type="button" class="ak-tabs__tab" :aria-selected="section === 'general'" @click="section = 'general'">通用</button>
          <button type="button" class="ak-tabs__tab" :aria-selected="section === 'models'" @click="section = 'models'">模型</button>
          <button type="button" class="ak-tabs__tab" :aria-selected="section === 'account'" @click="section = 'account'">账户</button>
        </div>
      </div>
    </nav>

    <div class="study-settings__body">
      <template v-if="section === 'general'">
        <article class="study-row is-focus">
          <div>
            <h3>界面语言</h3>
            <p>这一行是本页重心。改完应一眼能看见，而不是被切角和状态灯抢走。</p>
          </div>
          <label class="ak-field">
            <span class="ak-label">Language</span>
            <select v-model="language" class="ak-select">
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>
        </article>
        <article class="study-row">
          <div>
            <h3>工作产物</h3>
            <p>Coding、CTF 和 CVE 生成的文件写在用户文档目录。</p>
          </div>
          <button type="button" class="ak-button ak-button--outline" style="width:100%" @click="opened = true">
            <span class="ak-button__label">{{ opened ? '已记下路径' : '打开产物目录' }}</span>
          </button>
        </article>
      </template>

      <template v-else-if="section === 'models'">
        <article class="study-row is-focus">
          <div>
            <h3>默认模型</h3>
            <p>设置页与 Coding 共用同一可调用目录。预览不拉真实目录。</p>
          </div>
          <label class="ak-field">
            <span class="ak-label">Model</span>
            <select class="ak-select">
              <option>grok-4.5</option>
              <option>grok-4.6</option>
            </select>
          </label>
        </article>
      </template>

      <template v-else>
        <article class="study-row is-focus">
          <div>
            <h3>GitHub 账户</h3>
            <p>登录态只作展示。预览不会发起 PKCE。</p>
          </div>
          <button type="button" class="ak-button ak-button--outline" style="width:100%">
            <span class="ak-button__label">已登录</span>
          </button>
        </article>
      </template>
    </div>
  </div>
</template>
