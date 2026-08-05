# CTF 六赛道回归清单

> 状态：Evidence contract / pre-selection skeleton
>
> 对应目标：`CTF-12`
>
> 本页只定义六赛道真实验收需要留下什么证据，不声明 MilkSU 已经完成六赛道。

机器可校验清单位于
[`ctf-six-track-regression-manifest.json`](./ctf-six-track-regression-manifest.json)。

校验命令：

```bash
npm run test:ctf-six-track-regression
```

## 当前状态

| 赛道 | 当前状态 | 说明 |
| --- | --- | --- |
| Web | `judge-verified` | NSSCTF P3879 已有一条真实 `correct=true` 窄路径记录。 |
| Pwn | `missing` | 待选择授权真题并记录完整证据。 |
| Reverse | `missing` | 待选择授权真题并记录完整证据。 |
| Crypto | `missing` | 待选择授权真题并记录完整证据。 |
| Forensics | `missing` | 独立于 Misc，待选择授权真题并记录完整证据。 |
| Misc | `missing` | 独立于 Forensics，待选择授权真题并记录完整证据。 |

只有六个赛道都具备权威 Judge `correct=true` 回执，并且 `requiredEvidence` 中所有证据引用
齐全时，才能把六赛道状态称为 Ready。单题成功只能叫 smoke，不能写成整体 CTF 成绩。

## 每题必须保留的证据

- 授权题面及材料；
- Solver 轨迹和 Checkpoint；
- 候选及依据；
- 平台 Judge 回执；
- 提示依赖和用户贡献；
- 中断/恢复；
- 复盘和训练证据。

## 跨赛道协作验收

Tool Builder 和 Strategist 不要求每题都出现，分别只要求至少一次自然发生的跨赛道闭环：

- Solver 卡关后请求工具，Coding Agent 交付工具，Solver 使用结果继续；
- 重复失败后，Strategist 使用独立会话复盘并提出不同路线，再交回 Solver 验证。

这两项保存在 manifest 的 `crossTrackCollaborations` 中；未发生前保持 `missing`。
