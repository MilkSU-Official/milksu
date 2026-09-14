package evalsuite

import (
	"encoding/json"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/evalsuite/tasks"
)

type frontierSpec struct {
	ID                 string  `json:"id"`
	Slug               string  `json:"slug"`
	Source             string  `json:"source"`
	DockerImage        string  `json:"docker_image"`
	CPUs               float64 `json:"cpus"`
	MemoryMB           float64 `json:"memory_mb"`
	StorageMB          float64 `json:"storage_mb"`
	AgentTimeoutSec    float64 `json:"agent_timeout_sec"`
	VerifierTimeoutSec float64 `json:"verifier_timeout_sec"`
	Instruction        string  `json:"instruction"`
}

var (
	frontierOnce  sync.Once
	frontierCache []Task
)

func frontierTasks() []Task {
	frontierOnce.Do(func() {
		raw, err := tasks.FS.ReadFile("frontier/catalog.json")
		if err != nil {
			return
		}
		var specs []frontierSpec
		if err := json.Unmarshal(raw, &specs); err != nil {
			return
		}
		loaded := make([]Task, 0, len(specs))
		for _, spec := range specs {
			prompt := ""
			if spec.Instruction != "" {
				data, readErr := tasks.FS.ReadFile("frontier/" + spec.Instruction)
				if readErr == nil {
					prompt = string(data)
				}
			}
			slug := strings.TrimSpace(spec.Slug)
			timeout := time.Duration(spec.AgentTimeoutSec) * time.Second
			if timeout <= 0 {
				timeout = 15 * time.Minute
			}
			verify := time.Duration(spec.VerifierTimeoutSec) * time.Second
			if verify <= 0 {
				verify = timeout
			}
			id := strings.TrimSpace(spec.ID)
			if id == "" {
				id = slug
			}
			loaded = append(loaded, Task{
				ID:              id,
				Suite:           SuiteFrontier,
				Name:            slug,
				Kind:            KindDocker,
				Source:          spec.Source,
				Slug:            slug,
				Prompt:          strings.TrimSpace(prompt),
				DockerImage:     strings.TrimSpace(spec.DockerImage),
				CPUs:            spec.CPUs,
				MemoryMB:        int(spec.MemoryMB),
				StorageMB:       int(spec.StorageMB),
				Timeout:         timeout,
				VerifierTimeout: verify,
				TestsDir:        path.Join("frontier", "tests", slug),
			})
		}
		frontierCache = loaded
	})
	return frontierCache
}

func frontierSmoke(tasks []Task) []Task {
	var tb, swe Task
	for _, task := range tasks {
		switch task.Source {
		case "terminal-bench":
			if tb.ID == "" {
				tb = task
			}
		case "deepswe":
			if swe.ID == "" {
				swe = task
			}
		}
		if tb.ID != "" && swe.ID != "" {
			break
		}
	}
	out := make([]Task, 0, 2)
	if tb.ID != "" {
		out = append(out, tb)
	}
	if swe.ID != "" {
		out = append(out, swe)
	}
	if len(out) == 0 && len(tasks) > 0 {
		return tasks[:1]
	}
	return out
}
