import { useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import {
  ACP_AGENT_KINDS,
  acpAgentKindLabel,
  acpAgentPreset,
  createNamedAcpAgent,
  type AcpAgentKind,
  type NamedAcpAgent,
} from '@/lib/acpAgent'
import { useT } from '@/hooks/useUiLocale'

export default function AddAcpAgentDialog({
  open,
  existing,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  existing: readonly NamedAcpAgent[]
  onOpenChange: (open: boolean) => void
  onAdd: (agent: NamedAcpAgent) => void
}) {
  const t = useT()
  const [kind, setKind] = useState<AcpAgentKind>('acp')
  const [name, setName] = useState(acpAgentPreset('acp').name)
  const [nameTouched, setNameTouched] = useState(false)

  useEffect(() => {
    if (!open) return
    setKind('acp')
    setName(acpAgentPreset('acp').name)
    setNameTouched(false)
  }, [open])

  function changeKind(next: AcpAgentKind) {
    setKind(next)
    if (!nameTouched) setName(acpAgentPreset(next).name)
  }

  function submit() {
    const agent = createNamedAcpAgent({
      kind,
      name,
      existing,
    })
    onAdd(agent)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>{t('添加 Agent', 'Add Agent')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="add-acp-agent-kind">{t('类型', 'Type')}</Label>
            <Select value={kind} onValueChange={value => changeKind(value as AcpAgentKind)}>
              <SelectTrigger id="add-acp-agent-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACP_AGENT_KINDS.map(id => (
                  <SelectItem key={id} value={id}>
                    {acpAgentKindLabel(id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="add-acp-agent-name">{t('名称', 'Name')}</Label>
            <Input
              id="add-acp-agent-name"
              value={name}
              autoComplete="off"
              onChange={event => {
                setNameTouched(true)
                setName(event.target.value)
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('取消', 'Cancel')}
          </Button>
          <Button type="button" variant="brand" disabled={!name.trim()} onClick={submit}>
            {t('添加 Agent', 'Add Agent')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
