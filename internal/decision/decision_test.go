package decision

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeJev struct {
	noul   float64
	choice string
	err    error
	calls  int
}

func (f *fakeJev) Noul(ctx context.Context, state any, instructions string) (float64, error) {
	f.calls++
	if f.err != nil {
		return 0, f.err
	}
	return f.noul, nil
}

func (f *fakeJev) Choice(ctx context.Context, state any, instructions string, criteria map[string]string) (string, error) {
	f.calls++
	if f.err != nil {
		return "", f.err
	}
	return f.choice, nil
}

func TestNoulPrefersJev(t *testing.T) {
	jev := &fakeJev{noul: 0.2}
	layer := &Layer{
		Key:      func() string { return "key" },
		Complete: nil,
		jev:      jev,
	}
	yes, source, err := layer.Noul(context.Background(), map[string]any{"a": 1}, "问题")
	if err != nil {
		t.Fatal(err)
	}
	if source != SourceJev || yes != 0.2 {
		t.Fatalf("got %v %v", source, yes)
	}
	if jev.calls != 1 {
		t.Fatalf("jev calls = %d", jev.calls)
	}
}

func TestNoulFallsBackToModel(t *testing.T) {
	layer := &Layer{
		Key: func() string { return "" },
		Complete: func(ctx context.Context, systemPrompt, prompt string) (string, error) {
			if !strings.Contains(prompt, "问题") || !strings.Contains(prompt, `"a"`) {
				t.Fatalf("主模型兜底提示没带原问题和事实：%s", prompt)
			}
			return "0.73", nil
		},
	}
	yes, source, err := layer.Noul(context.Background(), map[string]any{"a": 1}, "问题")
	if err != nil {
		t.Fatal(err)
	}
	if source != SourceModel || yes != 0.73 {
		t.Fatalf("got %v %v", source, yes)
	}
}

func TestNoulFallsBackWhenJevFails(t *testing.T) {
	layer := &Layer{
		Key:      func() string { return "key" },
		Complete: func(ctx context.Context, systemPrompt, prompt string) (string, error) { return "0.1", nil },
		jev:      &fakeJev{err: errors.New("down")},
	}
	yes, source, err := layer.Noul(context.Background(), nil, "问题")
	if err != nil {
		t.Fatal(err)
	}
	if source != SourceModel || yes != 0.1 {
		t.Fatalf("got %v %v", source, yes)
	}
}

func TestNoulUnavailable(t *testing.T) {
	layer := &Layer{}
	if _, _, err := layer.Noul(context.Background(), nil, "问题"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}

	noParse := &Layer{Complete: func(ctx context.Context, systemPrompt, prompt string) (string, error) {
		return "说不清", nil
	}}
	if _, _, err := noParse.Noul(context.Background(), nil, "问题"); err == nil {
		t.Fatal("主模型回了非概率值时必须报错")
	}
}

func TestChoiceFallsBackToModel(t *testing.T) {
	criteria := map[string]string{
		"chat": "闲聊",
		"deep": "深入思考",
		"long": "长任务",
	}
	layer := &Layer{
		Key: func() string { return "" },
		Complete: func(ctx context.Context, systemPrompt, prompt string) (string, error) {
			if !strings.Contains(prompt, "long：长任务") {
				t.Fatalf("兜底提示没带选项：%s", prompt)
			}
			return "long", nil
		},
	}
	choice, source, err := layer.Choice(context.Background(), map[string]any{"prompt": "改下登录"}, "分成一档", criteria)
	if err != nil {
		t.Fatal(err)
	}
	if source != SourceModel || choice != "long" {
		t.Fatalf("got %v %q", source, choice)
	}
}

func TestChoiceUnavailableWithoutCompleter(t *testing.T) {
	layer := &Layer{Key: func() string { return "" }}
	if _, _, err := layer.Choice(context.Background(), nil, "分成一档", map[string]string{"a": "甲", "b": "乙"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
}

func TestParseProbability(t *testing.T) {
	for input, want := range map[string]float64{
		"0.5": 0.5, " 0.25 ": 0.25, "`0.9`": 0.9, "1": 1, "p=0.3": 0.3, "0.": 0,
	} {
		got, ok := parseProbability(input)
		if !ok || got != want {
			t.Fatalf("%q -> %v %v, want %v", input, got, ok, want)
		}
	}
	for _, input := range []string{"", "abc", "1.5", "-0.1", "fifty"} {
		if _, ok := parseProbability(input); ok {
			t.Fatalf("%q must not parse", input)
		}
	}
}
