package evalsuite

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/evalsuite/tasks"
)

const (
	KindFlag       = "flag"
	KindSanitizer  = "sanitizer"
	KindMilestones = "milestones"
)

type Milestone struct {
	Name      string
	AccessLog bool
	Traversal bool
	FlagFile  bool
}

type Task struct {
	ID           string
	Suite        string
	Name         string
	Kind         string
	Difficulty   float64
	Prompt       string
	FlagSHA256   string
	Files        map[string][]byte
	Patch        []byte
	PoCFile      string
	VulnSource   string
	Milestones   []Milestone
	StartHarness bool
}

func Suites() []SuiteView {
	return []SuiteView{
		{ID: SuiteCybench, Name: "Cybench", Purpose: "CTF 题", Runnable: len(cybenchTasks()) > 0, TaskN: len(cybenchTasks())},
		{ID: SuiteSECBench, Name: "SEC-bench", Purpose: "已知洞复现", Runnable: len(secbenchTasks()) > 0, TaskN: len(secbenchTasks())},
		{ID: SuiteAutoPen, Name: "AutoPenBench", Purpose: "授权渗透", Runnable: len(autopenTasks()) > 0, TaskN: len(autopenTasks())},
	}
}

func TasksFor(suite string) []Task {
	switch suite {
	case SuiteCybench:
		return cybenchTasks()
	case SuiteSECBench:
		return secbenchTasks()
	case SuiteAutoPen:
		return autopenTasks()
	default:
		return nil
	}
}

type taskFile struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Kind         string   `json:"kind"`
	Difficulty   float64  `json:"difficulty"`
	Prompt       string   `json:"prompt"`
	FlagSHA256   string   `json:"flag_sha256"`
	Files        []string `json:"files"`
	PatchFile    string   `json:"patch_file"`
	PoCFile      string   `json:"poc_file"`
	VulnSource   string   `json:"vuln_source"`
	StartHarness bool     `json:"start_harness"`
	Milestones   []struct {
		Name      string `json:"name"`
		AccessLog bool   `json:"access_log"`
		Traversal bool   `json:"traversal"`
		FlagFile  bool   `json:"flag_file"`
	} `json:"milestones"`
}

func cybenchTasks() []Task {
	return loadSuiteTasks("cybench")
}

func secbenchTasks() []Task {
	return loadSuiteTasks("secbench")
}

func autopenTasks() []Task {
	return loadSuiteTasks("autopen")
}

func loadSuiteTasks(suiteDir string) []Task {
	entries, err := fs.ReadDir(tasks.FS, suiteDir)
	if err != nil {
		return nil
	}
	loaded := make([]Task, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		task, ok := loadTaskDir(suiteDir + "/" + entry.Name())
		if ok {
			loaded = append(loaded, task)
		}
	}
	sort.SliceStable(loaded, func(i, j int) bool {
		if loaded[i].Difficulty != loaded[j].Difficulty {
			return loaded[i].Difficulty < loaded[j].Difficulty
		}
		return loaded[i].ID < loaded[j].ID
	})
	return loaded
}

func loadTaskDir(dir string) (Task, bool) {
	raw, err := tasks.FS.ReadFile(dir + "/task.json")
	if err != nil {
		return Task{}, false
	}
	var spec taskFile
	if err := json.Unmarshal(raw, &spec); err != nil {
		return Task{}, false
	}
	files := map[string][]byte{}
	for _, name := range spec.Files {
		data, readErr := tasks.FS.ReadFile(dir + "/" + name)
		if readErr != nil {
			return Task{}, false
		}
		files[name] = data
	}
	var patch []byte
	if spec.PatchFile != "" {
		data, readErr := tasks.FS.ReadFile(dir + "/" + spec.PatchFile)
		if readErr != nil {
			return Task{}, false
		}
		patch = data
	}
	milestones := make([]Milestone, 0, len(spec.Milestones))
	for _, item := range spec.Milestones {
		milestones = append(milestones, Milestone{
			Name: item.Name, AccessLog: item.AccessLog, Traversal: item.Traversal, FlagFile: item.FlagFile,
		})
	}
	kind := spec.Kind
	if kind == "" {
		kind = KindFlag
	}
	id := spec.ID
	if id == "" {
		id = strings.ReplaceAll(dir, "/", "-")
	}
	return Task{
		ID:           id,
		Suite:        strings.SplitN(dir, "/", 2)[0],
		Name:         spec.Name,
		Kind:         kind,
		Difficulty:   spec.Difficulty,
		Prompt:       spec.Prompt,
		FlagSHA256:   spec.FlagSHA256,
		Files:        files,
		Patch:        patch,
		PoCFile:      spec.PoCFile,
		VulnSource:   spec.VulnSource,
		Milestones:   milestones,
		StartHarness: spec.StartHarness,
	}, true
}

func materialize(task Task, directory string) error {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create eval workspace: %w", err)
	}
	for name, data := range task.Files {
		path := filepath.Join(directory, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return fmt.Errorf("create %s: %w", name, err)
		}
		if err := os.WriteFile(path, data, 0o600); err != nil {
			return fmt.Errorf("write %s: %w", name, err)
		}
	}
	return nil
}
