// Package decision 是产品里唯一的决策层入口。所有「问一个校准问题」的
// 调用点（看板娘分档、记忆闸、开口闸、复读示警复核、审批风险分）都引用
// 这里的 Layer，默认机制只有一套：
//
//  1. 配了决策凭据 → 先问托管决策 API（jev.Noul / jev.Choice），拿校准概率。
//  2. 没配凭据、调用失败或返回不可用 → 回退到当前对话的主模型打一次
//     轻量问答（侧车 completeSimple，不另开内核、不在当轮顺口识别），
//     按同样的形式（概率小数 / 档名）解析，来源记为 SourceModel。
//  3. 两边都不通 → 返回错误，由调用点按各自语义 fail-open。
//
// 调用点不允许自写兜底行为；阈值、超时、失败方向留在各调用点。
package decision

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/jev"
)

// Source 记录这次判定是谁给的，折叠里写「由谁判定」。
type Source string

const (
	// SourceJev 是托管决策 API 的校准答案。
	SourceJev Source = "jev"
	// SourceModel 是主模型兜底给出的未校准答案。
	SourceModel Source = "model"
)

// ErrUnavailable 表示决策凭据和主模型兜底都不通。
var ErrUnavailable = errors.New("decision layer unavailable")

// Completer 用当前对话的主模型做一次轻量问答。systemPrompt 要求只回答案
// 本身；返回值是模型的原始可见文本，由 Layer 解析。
type Completer func(ctx context.Context, systemPrompt, prompt string) (string, error)

// KeyFunc 返回决策凭据；空串表示没配。
type KeyFunc func() string

// jevCaller 是托管决策 API 的门面，测试换成假的。
type jevCaller interface {
	Noul(ctx context.Context, state any, instructions string) (float64, error)
	Choice(ctx context.Context, state any, instructions string, criteria map[string]string) (string, error)
}

type liveJev struct{ key string }

func (j liveJev) Noul(ctx context.Context, state any, instructions string) (float64, error) {
	return (&jev.Client{Key: j.key}).Noul(ctx, state, instructions)
}

func (j liveJev) Choice(ctx context.Context, state any, instructions string, criteria map[string]string) (string, error) {
	return (&jev.Client{Key: j.key}).Choice(ctx, state, instructions, criteria)
}

// Layer 是一次决策机制：Key 找凭据，Complete 找主模型。两个都为 nil 时
// 每次调用直接返回 ErrUnavailable，调用点照旧 fail-open。
type Layer struct {
	Key      KeyFunc
	Complete Completer

	// jev 缺省时按 Key 现建；测试注入假的。
	jev jevCaller
}

func (l *Layer) key() string {
	if l == nil || l.Key == nil {
		return ""
	}
	return strings.TrimSpace(l.Key())
}

func (l *Layer) jevCaller() jevCaller {
	if l == nil {
		return nil
	}
	if l.jev != nil {
		return l.jev
	}
	if key := l.key(); key != "" {
		return liveJev{key: key}
	}
	return nil
}

func (l *Layer) completer() Completer {
	if l == nil {
		return nil
	}
	return l.Complete
}

// Noul 问一个是非问题，回 0..1 的校准概率。Jev 优先，主模型兜底按同样的
// 概率形式解析；都失败返回错误。
func (l *Layer) Noul(ctx context.Context, state any, instructions string) (float64, Source, error) {
	var lastErr error
	if caller := l.jevCaller(); caller != nil {
		yes, err := caller.Noul(ctx, state, instructions)
		if err == nil {
			return yes, SourceJev, nil
		}
		lastErr = err
	}
	complete := l.completer()
	if complete != nil {
		text, err := complete(ctx,
			"只回答一个 0 到 1 的小数，不要别的字。",
			noulModelPrompt(state, instructions))
		if err == nil {
			if yes, ok := parseProbability(text); ok {
				return yes, SourceModel, nil
			}
			err = fmt.Errorf("model returned no probability: %q", truncate(text, 80))
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = ErrUnavailable
	}
	return 0, "", lastErr
}

// Choice 问一个档名问题，答案是 criteria 的一个键。Jev 优先，主模型兜底
// 要求只回键名；都失败返回错误。
func (l *Layer) Choice(ctx context.Context, state any, instructions string, criteria map[string]string) (string, Source, error) {
	var lastErr error
	if caller := l.jevCaller(); caller != nil {
		choice, err := caller.Choice(ctx, state, instructions, criteria)
		if err == nil {
			return choice, SourceJev, nil
		}
		lastErr = err
	}
	complete := l.completer()
	if complete != nil {
		text, err := complete(ctx,
			"只回答一个选项键名，不要别的字。",
			choiceModelPrompt(state, instructions, criteria))
		if err == nil {
			if choice, ok := matchChoice(text, criteria); ok {
				return choice, SourceModel, nil
			}
			err = fmt.Errorf("model returned no known choice: %q", truncate(text, 80))
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = ErrUnavailable
	}
	return "", "", lastErr
}

func noulModelPrompt(state any, instructions string) string {
	var b strings.Builder
	b.WriteString(strings.TrimSpace(instructions))
	b.WriteString("\n\n事实（JSON）：\n")
	b.WriteString(marshalState(state))
	b.WriteString("\n\n")
	b.WriteString("把「是」的校准概率写成一个 0 到 1 的小数，只回这个数。")
	return b.String()
}

func choiceModelPrompt(state any, instructions string, criteria map[string]string) string {
	var b strings.Builder
	b.WriteString(strings.TrimSpace(instructions))
	b.WriteString("\n\n事实（JSON）：\n")
	b.WriteString(marshalState(state))
	b.WriteString("\n\n选项：\n")
	for key, text := range criteria {
		b.WriteString("- ")
		b.WriteString(key)
		b.WriteString("：")
		b.WriteString(strings.TrimSpace(text))
		b.WriteString("\n")
	}
	b.WriteString("\n只回其中一个键名。")
	return b.String()
}

func marshalState(state any) string {
	if state == nil {
		return "{}"
	}
	encoded, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", state)
	}
	return string(encoded)
}

func parseProbability(text string) (float64, bool) {
	cleaned := strings.TrimSpace(text)
	cleaned = strings.Trim(cleaned, "`")
	cleaned = strings.TrimSpace(strings.TrimPrefix(cleaned, "p="))
	cleaned = strings.TrimSuffix(cleaned, ".")
	yes, err := strconv.ParseFloat(cleaned, 64)
	if err != nil || yes < 0 || yes > 1 {
		return 0, false
	}
	return yes, true
}

func matchChoice(text string, criteria map[string]string) (string, bool) {
	cleaned := strings.Trim(strings.TrimSpace(text), "`")
	for key := range criteria {
		if cleaned == key {
			return key, true
		}
	}
	lower := strings.ToLower(cleaned)
	for key := range criteria {
		if lower == strings.ToLower(key) {
			return key, true
		}
	}
	return "", false
}

func truncate(text string, max int) string {
	text = strings.TrimSpace(text)
	if len(text) <= max {
		return text
	}
	return text[:max] + "…"
}
