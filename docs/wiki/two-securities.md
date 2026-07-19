# 两种“安全”

## Agent Security

保护 Agent 自己、凭据、用户数据和工具边界。它回答：**Agent 在接触不可信内容和高权限工具时，怎样不被诱导或越权？**

普通浏览、邮件和 Coding Agent 同样需要这类保护，所以它不是安全任务 Agent 的专属能力。

## Agent for Security

让 Agent 完成安全任务。它回答：**红队、蓝队、CTF、AppSec、恶意样本分析或漏洞研究怎样产生可验证结果？**

一个隔离 CTF 任务可以是 Agent for Security，却不一定面对正在攻击 Agent 的对手。

## 两者可以组合

读取生产日志的蓝队 Agent、分析恶意样本的 Agent，通常既在做安全任务，也需要更强的 Agent Security。四象限完整解释见[能力边界](/developer/security-agent-boundary#agent-security-和-agent-for-security-不是一回事)。
