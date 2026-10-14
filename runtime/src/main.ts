import './domains/index.ts'
import {
  AgentResourceStore,
  CodingToolsService,
  SettingsSecretKeeper,
} from './agentresources/index.ts'
import { SettingsStore } from './config/settings-store.ts'
import { ConversationStore } from './conversations.ts'
import { closeBrowserCap } from './domains/browser.ts'
import { closeComputerUse } from './domains/computeruse.ts'
import { bindCodingEnv } from './domains/codingenv.ts'
import { bindTerminals } from './domains/terminals.ts'
import { applyStartupRestore, bindPlatformServices, beginRuntimeLifespan, markRuntimeCleanExit } from './domains/platform.ts'
import { bindAgentResourceStore, bindCodingTools } from './domains/resources.ts'
import { Engine } from './engine.ts'
import {
  AttachmentStore,
  ProjectMemoryStore,
  PullRequestPublisher,
  TerminalManager,
  createHelperPtyDriver,
} from './codingenv/index.ts'
import { handleOwnedMethod, isOwnedMethod, assertInvokeSource } from './handlers.ts'
import { dataDirectory, modelUsagePath, resolveHomeRoot } from './home.ts'
import { ModelUsageStore } from './modelusage/index.ts'
import { LabJobStore } from './lab.ts'
import { ResearchService } from './research/service.ts'
import {
  CompanionRuntime,
  companionAgentDirectory,
  companionStatePath,
  createCompanionAppControl,
  createCompanionCatalog,
  createCompanionControl,
  createCompanionSpeaker,
} from './companion/index.ts'
import { NativeHelper, resolveNativeHelperPath } from './native-helper.ts'
import { DesktopHost, JsonlPort, type RpcMessage, type RpcSource } from './rpc.ts'
import { generateTraceId, normalizeTraceId } from './trace.ts'
import { userArtifactDirectory, VulnService } from './vuln/index.ts'

function logBoot(home: string): void {
  const bootTrace = normalizeTraceId(process.env.MILKSU_TRACE_ID) || generateTraceId()
  console.error(`[${bootTrace}] runtime boot home=${home}`)
}

async function main(): Promise<void> {
  const home = resolveHomeRoot()
  logBoot(home)
  await applyStartupRestore(home)
  await beginRuntimeLifespan(home)

  const desktop = new JsonlPort(process.stdin, process.stdout)
  const conversations = await ConversationStore.open(home)
  const labJobs = await LabJobStore.open(home)
  const vuln = VulnService.open(home, userArtifactDirectory())
  await vuln.recover()
  const research = ResearchService.open(dataDirectory(home))
  await research.recover()

  const helperPath = resolveNativeHelperPath()
  if (!helperPath) {
    throw new Error('MILKSU_NATIVE_HELPER or MILKSU_BACKEND_PATH is required')
  }

  let companion: CompanionRuntime | undefined
  let ptyDriver: ReturnType<typeof createHelperPtyDriver> | undefined
  const emit = (event: string, payload: unknown) => {
    if (event === 'engine-event' && companion) {
      companion.observeEngineEvent(payload as { type: string; sessionId?: string; error?: string })
    }
    void desktop.write({ type: 'event', event, payload })
  }
  const host = new DesktopHost((message) => desktop.write(message))

  const helper = new NativeHelper({
    command: helperPath,
    env: process.env,
    onEvent: (event, payload) => {
      if (ptyDriver?.handleEvent(event, payload)) return
      emit(event, payload)
    },
    onHostRequest: (message) => {
      void desktop.write({
        type: 'host_request',
        id: message.id,
        method: message.method,
        payload: message.payload,
      })
    },
    onProtocolError: (error) => {
      void desktop.write({ type: 'protocol_error', error })
    },
  })
  await helper.start()

  let helperInvokeSeq = 0
  const invokeHelper = (
    method: string,
    args: unknown[],
    source: RpcSource = 'renderer',
  ): Promise<unknown> => {
    helperInvokeSeq += 1
    return helper.invoke({
      type: 'invoke',
      id: `runtime-helper-${helperInvokeSeq}`,
      source,
      method,
      args,
    })
  }

  const settings = await SettingsStore.open({
    home,
    invokeHelper: (method, args) => invokeHelper(method, args, 'electron_host'),
  })
  const agentResources = await AgentResourceStore.open(
    dataDirectory(home),
    new SettingsSecretKeeper(settings.secretStore()),
  )
  const codingTools = new CodingToolsService(dataDirectory(home), (snapshot) => {
    emit('coding-tool-setup', snapshot)
  })
  bindAgentResourceStore(home, agentResources)
  bindCodingTools(home, codingTools)
  await bindPlatformServices({ home, settings, emit })
  const codingProjects = await ProjectMemoryStore.open(home)
  const codingAttachments = await AttachmentStore.open(home)
  const modelUsage = ModelUsageStore.open(modelUsagePath(home))
  bindCodingEnv(home, {
    projects: codingProjects,
    attachments: codingAttachments,
    pullRequests: new PullRequestPublisher(),
    usage: modelUsage,
  })
  ptyDriver = createHelperPtyDriver(invokeHelper)
  const terminals = new TerminalManager({
    driver: ptyDriver,
    emit: (event) => emit('coding-terminal-event', event),
  })
  ptyDriver.attach({
    output: (id, data) => terminals.handlePtyOutput(id, data),
    exit: (id, code, error) => terminals.handlePtyExit(id, code, error),
  })
  bindTerminals(home, terminals)
  const originalDelete = conversations.delete.bind(conversations)
  conversations.delete = async (id) => {
    await terminals.closeConversation(id)
    return originalDelete(id)
  }
  const originalDeleteArchived = conversations.deleteArchived.bind(conversations)
  conversations.deleteArchived = async (id) => {
    await terminals.closeConversation(id)
    return originalDeleteArchived(id)
  }
  const originalArchive = conversations.archive.bind(conversations)
  conversations.archive = async (id) => {
    await terminals.closeConversation(id)
    return originalArchive(id)
  }

  const engine = new Engine(
    home,
    conversations,
    helperPath,
    emit,
    (message) => helper.invoke(message),
    () => agentResources,
  )
  engine.attachResearch(research)
  engine.attachSettings(settings)
  engine.attachUsage(modelUsage)
  engine.attachLabJobs(labJobs)

  const catalog = createCompanionCatalog({ conversations, settings, emit })
  companion = new CompanionRuntime({
    home,
    agentDir: companionAgentDirectory(home),
    statePath: companionStatePath(home),
    helperPath,
    settings: () => settings.getResolved(),
    sidecarEnv: () => settings.exportSidecarEnvironment(),
    catalog,
    speaker: createCompanionSpeaker({ conversations, engine }),
    control: createCompanionControl(engine),
    app: createCompanionAppControl({
      conversations,
      settings,
      hostCall: (method, payload) => host.call(method, payload),
      emit,
    }),
    emit: (event) => emit('companion-event', event),
  })
  engine.attachCompanion(companion)
  const saveSettings = settings.save.bind(settings)
  settings.save = async (value) => {
    await saveSettings(value)
    companion?.markStale()
    void companion?.syncLiveContext()
  }

  const ctx = {
    conversations,
    labJobs,
    research,
    engine,
    emit,
    home,
    invokeHelper,
    hostCall: (method: string, payload?: unknown) => host.call(method, payload),
    agentResources,
    codingTools,
    settings,
    vuln,
    companion,
  }

  const serve = desktop.onLine((message) => {
    void handleDesktopMessage(message)
  })

  async function handleDesktopMessage(message: RpcMessage): Promise<void> {
    switch (message.type) {
      case 'protocol_error':
        await desktop.write({
          type: 'protocol_error',
          id: message.id,
          error: message.error || 'invalid desktop RPC message',
        })
        return
      case 'invoke':
        await handleInvoke(message)
        return
      case 'host_response':
        if (!host.settle(message)) await helper.forwardRaw(message)
        return
      case 'shutdown':
        serve.close()
        await companion?.stop()
        await terminals.close()
        await closeBrowserCap(home)
        await closeComputerUse(home)
        await engine.stopAll()
        research.close()
        vuln.close()
        modelUsage.close()
        await markRuntimeCleanExit(home)
        await helper.shutdown()
        process.exit(0)
        return
      default:
        await desktop.write({
          type: 'protocol_error',
          id: message.id,
          error: 'unsupported desktop RPC message type',
        })
    }
  }

  async function handleInvoke(message: RpcMessage): Promise<void> {
    const id = String(message.id ?? '')
    const method = String(message.method ?? '').trim()
    const source = String(message.source ?? '') as RpcSource
    try {
      assertInvokeSource(method, source)
      if (isOwnedMethod(method)) {
        const result = await handleOwnedMethod(ctx, source, method, message.args)
        await desktop.write({ type: 'result', id, result: result ?? null })
        return
      }
      const result = await helper.invoke(message)
      await desktop.write({ type: 'result', id, result: result ?? null })
    } catch (error) {
      await desktop.write({
        type: 'result',
        id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  process.stdin.on('end', () => {
    void (async () => {
      await companion?.stop()
      await terminals.close()
      await closeBrowserCap(home)
      await closeComputerUse(home)
      await engine.stopAll()
      research.close()
      vuln.close()
      modelUsage.close()
      await markRuntimeCleanExit(home)
      await helper.shutdown()
      process.exit(0)
    })()
  })

  await desktop.write({ type: 'ready' })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
