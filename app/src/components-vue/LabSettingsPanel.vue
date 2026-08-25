<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Button, Input, SettingsRow, SettingsSection, Switch } from '@felinic/ui'
import { Check, FolderOpen, RotateCcw } from 'lucide-vue-next'
import { desktopErrorMessage, invokeCommand } from '@/desktop'
import type { LabEnvironmentStatus } from '@/envbroker'
import { t } from '@/lib/uiLocale'
import type { AppSettings } from '@/types'

const props = defineProps<{
  settings: AppSettings | null
}>()

const probing = ref(false)
const choosing = ref<'sdk' | 'java' | ''>('')
const openingStudio = ref(false)
const error = ref('')
const status = ref<LabEnvironmentStatus | null>(null)
const showAdvanced = ref(false)

const lab = computed(() => props.settings?.lab ?? {
  android_sdk: '',
  java_home: '',
  auto_create_avd: true,
})

function patchLab(patch: Partial<NonNullable<AppSettings['lab']>>) {
  if (!props.settings) return
  props.settings.lab = {
    android_sdk: lab.value.android_sdk ?? '',
    java_home: lab.value.java_home ?? '',
    auto_create_avd: lab.value.auto_create_avd !== false,
    ...patch,
  }
}

function missing(id: string) {
  return Boolean(status.value?.missing?.includes(id))
}

function sourceLabel(source: string | undefined) {
  if (source === 'settings') return t('你指定的目录', 'Folder you chose')
  if (source === 'android-studio') return t('Android Studio 自带', 'Bundled with Android Studio')
  if (source === 'env') return t('环境变量', 'Environment variable')
  if (source === 'homebrew') return t('本机已安装的 JDK', 'JDK already on this computer')
  if (source === 'os') return t('本机已安装的 JDK', 'JDK already on this computer')
  if (source === 'default') return t('本机默认位置', 'Default location on this computer')
  return ''
}

const headline = computed(() => {
  const current = status.value
  if (!current) return t('正在检测这台电脑能不能跑 Android 练习包。', 'Checking whether this computer can run Android practice packages.')
  if (current.ready) {
    return t('这台电脑可以启动 Android 练习包。', 'This computer can start Android practice packages.')
  }
  if (!current.studioFound && missing('sdk')) {
    return t('先安装免费的 Android Studio。装好 SDK 和模拟器后，回到这里点重新检测。Windows、macOS、Linux 都一样。', 'Install free Android Studio first. After the SDK and emulator are in place, come back here and recheck. This is the same on Windows, macOS, and Linux.')
  }
  if (missing('cmdline-tools')) {
    return t('已经找到 SDK。打开 Android Studio 的 SDK Manager，勾选 Android SDK Command-line Tools。', 'The SDK is present. Open SDK Manager in Android Studio and enable Android SDK Command-line Tools.')
  }
  if (missing('system-image')) {
    return t('还差系统镜像。在 SDK Manager 的 SDK Platforms 里安装一个镜像（Apple Silicon 用 ARM 64，电脑是 x64 用 x86_64）。', 'A system image is still missing. In SDK Manager → SDK Platforms, install one image (ARM 64 on Apple Silicon, x86_64 on x64 PCs).')
  }
  if (missing('jdk')) {
    return t('创建模拟器需要 Java。安装或打开一次 Android Studio 即可，不必单独配 JAVA_HOME。', 'Creating an emulator needs Java. Install or open Android Studio once. You do not need to set JAVA_HOME yourself.')
  }
  if (missing('emulator') || missing('platform-tools')) {
    return t('在 SDK Manager 的 SDK Tools 里勾选 Android Emulator 和 Android SDK Platform-Tools。', 'In SDK Manager → SDK Tools, enable Android Emulator and Android SDK Platform-Tools.')
  }
  return t('按下面的清单补齐缺的项，然后重新检测。', 'Finish the missing items in the list below, then recheck.')
})

async function probe() {
  probing.value = true
  error.value = ''
  try {
    status.value = await invokeCommand<LabEnvironmentStatus>('get_lab_environment_status', {
      androidSdk: lab.value.android_sdk ?? '',
      javaHome: lab.value.java_home ?? '',
      autoCreateAvd: lab.value.auto_create_avd !== false,
    })
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    probing.value = false
  }
}

async function choose(kind: 'sdk' | 'java') {
  choosing.value = kind
  error.value = ''
  try {
    const selected = await invokeCommand<string>('choose_lab_path', { kind })
    const path = String(selected ?? '').trim()
    if (!path) return
    if (kind === 'sdk') patchLab({ android_sdk: path })
    else patchLab({ java_home: path })
    await probe()
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    choosing.value = ''
  }
}

async function openStudio() {
  openingStudio.value = true
  error.value = ''
  try {
    await invokeCommand('open_android_studio_setup')
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    openingStudio.value = false
  }
}

onMounted(() => {
  void probe()
})
</script>

<template>
  <div v-if="settings">
    <SettingsSection :title="t('开始之前', 'Before you start')">
      <p class="px-4 py-3 text-body leading-6">{{ headline }}</p>
      <div class="flex flex-wrap gap-2 px-4 pb-4">
        <Button variant="brand" size="sm" :loading="openingStudio" @click="openStudio">
          {{ status?.studioFound ? t('打开 Android Studio', 'Open Android Studio') : t('安装 Android Studio', 'Install Android Studio') }}
        </Button>
        <Button variant="outline" size="sm" :loading="probing" @click="probe">
          <RotateCcw class="size-3.5" />
          {{ t('重新检测', 'Recheck') }}
        </Button>
      </div>
    </SettingsSection>

    <SettingsSection :title="t('这台电脑', 'This computer')" class="mt-6">
      <SettingsRow :label="t('Android SDK', 'Android SDK')" :description="status?.sdkRoot || t('还没找到。安装 Android Studio 时会带上。', 'Not found yet. Android Studio installs this.')">
        <span class="text-caption" :class="status?.sdkRoot ? 'text-muted-foreground' : 'text-destructive'">
          <Check v-if="status?.sdkRoot" class="mr-1 inline size-3.5" />
          {{ status?.sdkRoot ? (sourceLabel(status.sdkSource) || t('已找到', 'Found')) : t('缺少', 'Missing') }}
        </span>
      </SettingsRow>
      <SettingsRow :label="t('模拟器', 'Emulator')" :description="status?.emulator || t('在 SDK Manager → SDK Tools 勾选 Android Emulator。', 'Enable Android Emulator in SDK Manager → SDK Tools.')">
        <span class="text-caption" :class="status?.emulator ? 'text-muted-foreground' : 'text-destructive'">
          {{ status?.emulator ? t('已找到', 'Found') : t('缺少', 'Missing') }}
        </span>
      </SettingsRow>
      <SettingsRow :label="t('命令行工具', 'Command-line tools')" :description="status?.avdmanager || t('在 SDK Manager → SDK Tools 勾选 Android SDK Command-line Tools。用来创建 MilkSU-Lab。', 'Enable Android SDK Command-line Tools in SDK Manager → SDK Tools. Needed to create MilkSU-Lab.')">
        <span class="text-caption" :class="status?.avdmanager ? 'text-muted-foreground' : 'text-destructive'">
          {{ status?.avdmanager ? t('已找到', 'Found') : t('缺少', 'Missing') }}
        </span>
      </SettingsRow>
      <SettingsRow :label="t('Java', 'Java')" :description="status?.javaOk ? (status.javaHome || sourceLabel(status.javaSource)) : t('不用单独装 JDK。装好 Android Studio 后这里会变成就绪。', 'You do not install a JDK separately. This turns ready after Android Studio is installed.')">
        <span class="text-caption" :class="status?.javaOk ? 'text-muted-foreground' : 'text-destructive'">
          {{ status?.javaOk ? (sourceLabel(status.javaSource) || t('已找到', 'Found')) : t('缺少', 'Missing') }}
        </span>
      </SettingsRow>
      <SettingsRow :label="t('系统镜像', 'System image')" :description="status?.systemImage || t('在 SDK Manager → SDK Platforms 安装一个系统镜像。', 'Install a system image in SDK Manager → SDK Platforms.')" :divider="false">
        <span class="text-caption" :class="status?.systemImage ? 'text-muted-foreground' : 'text-destructive'">
          {{ status?.systemImage ? t('已找到', 'Found') : t('缺少', 'Missing') }}
        </span>
      </SettingsRow>
      <p v-if="error" class="px-4 pb-3 text-caption text-destructive">{{ error }}</p>
    </SettingsSection>

    <SettingsSection :title="t('创建实验室模拟器', 'Create the lab emulator')" class="mt-6">
      <SettingsRow
        :label="t('自动创建 MilkSU-Lab', 'Create MilkSU-Lab automatically')"
        :description="t('第一次启动 Android 练习包时，用上面的 SDK 建专用模拟器。日常手机模拟器不会被占用。', 'The first Android practice start creates a dedicated emulator from the SDK above. Your daily phone emulator is left alone.')"
        :divider="false"
      >
        <Switch
          :model-value="lab.auto_create_avd !== false"
          :aria-label="t('自动创建 MilkSU-Lab', 'Create MilkSU-Lab automatically')"
          @update:model-value="patchLab({ auto_create_avd: Boolean($event) })"
        />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection :title="t('自定义位置', 'Custom locations')" class="mt-6">
      <SettingsRow
        :label="t('不是默认安装路径', 'Not the default install path')"
        :description="t('只有 SDK 或 Java 不在常见位置时才需要填。新用户可以不管。', 'Fill this in only if the SDK or Java is not in a usual place. New users can ignore it.')"
        :divider="false"
      >
        <Button variant="outline" size="sm" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? t('收起', 'Hide') : t('指定目录', 'Choose folders') }}
        </Button>
      </SettingsRow>
      <template v-if="showAdvanced">
        <SettingsRow stack="always" :label="t('Android SDK 目录', 'Android SDK folder')">
          <div class="flex min-w-0 items-center gap-2">
            <Input
              class="min-w-0 flex-1"
              :model-value="lab.android_sdk ?? ''"
              :placeholder="t('留空则自动找', 'Leave empty to auto-detect')"
              :aria-label="t('Android SDK 目录', 'Android SDK folder')"
              @update:model-value="patchLab({ android_sdk: String($event) })"
            />
            <Button variant="outline" size="sm" :loading="choosing === 'sdk'" @click="choose('sdk')">
              <FolderOpen class="size-3.5" />
              {{ t('选择', 'Choose') }}
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow stack="always" :label="t('JDK 目录', 'JDK folder')" :divider="false">
          <div class="flex min-w-0 items-center gap-2">
            <Input
              class="min-w-0 flex-1"
              :model-value="lab.java_home ?? ''"
              :placeholder="t('留空则用 Android Studio 自带 Java', 'Leave empty to use Java bundled with Android Studio')"
              :aria-label="t('JDK 目录', 'JDK folder')"
              @update:model-value="patchLab({ java_home: String($event) })"
            />
            <Button variant="outline" size="sm" :loading="choosing === 'java'" @click="choose('java')">
              <FolderOpen class="size-3.5" />
              {{ t('选择', 'Choose') }}
            </Button>
          </div>
        </SettingsRow>
      </template>
    </SettingsSection>
  </div>
</template>
