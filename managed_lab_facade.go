package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/labmanager"
	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	managedLabStartTimeout     = 8 * time.Minute
	managedLabLifecycleTimeout = 3 * time.Minute
	managedLabReconcileTimeout = 30 * time.Second
	managedLabAccessFile       = "lab-access.json"
)

type ManagedLabTrainingWorkspace struct {
	Instance labmanager.State          `json:"instance"`
	CTF      ctf.Projection            `json:"ctf"`
	Handoff  ctf.AgentWorkspaceHandoff `json:"handoff"`
}

type ManagedLabJudgeResponse struct {
	Result labmanager.JudgeResult `json:"result"`
	CTF    ctf.Projection         `json:"ctf"`
}

// ListManagedLabPackages exposes only validated, bundled LabPackage metadata.
// Runtime lifecycle and Docker details remain owned by internal/labmanager.
func (a *App) ListManagedLabPackages() []labmanager.Definition {
	if a.managedLabs == nil {
		return []labmanager.Definition{}
	}
	return a.managedLabs.Catalog()
}

func (a *App) ListManagedLabInstances() []labmanager.State {
	if a.managedLabs == nil {
		return []labmanager.State{}
	}
	return a.managedLabs.ListInstances()
}

func (a *App) GetManagedLabInstance(instanceID string) (labmanager.State, error) {
	if a.managedLabs == nil {
		return labmanager.State{}, fmt.Errorf("managed lab service is unavailable")
	}
	return a.managedLabs.Status(strings.TrimSpace(instanceID))
}

func (a *App) StartManagedLab(packageID string) (labmanager.State, error) {
	if a.managedLabs == nil {
		return labmanager.State{}, fmt.Errorf("managed lab service is unavailable")
	}
	ctx, cancel := context.WithTimeout(a.commandContext(), managedLabStartTimeout)
	defer cancel()
	return a.managedLabs.Start(ctx, strings.TrimSpace(packageID))
}

func (a *App) ResetManagedLab(instanceID string) (labmanager.State, error) {
	if a.managedLabs == nil {
		return labmanager.State{}, fmt.Errorf("managed lab service is unavailable")
	}
	ctx, cancel := context.WithTimeout(a.commandContext(), managedLabLifecycleTimeout)
	defer cancel()
	instanceID = strings.TrimSpace(instanceID)
	state, err := a.managedLabs.Reset(ctx, instanceID)
	if err == nil {
		a.removeManagedLabWorkspaceAccess(instanceID)
	}
	return state, err
}

func (a *App) StopManagedLab(instanceID string) (labmanager.State, error) {
	if a.managedLabs == nil {
		return labmanager.State{}, fmt.Errorf("managed lab service is unavailable")
	}
	ctx, cancel := context.WithTimeout(a.commandContext(), managedLabLifecycleTimeout)
	defer cancel()
	return a.managedLabs.Stop(ctx, strings.TrimSpace(instanceID))
}

func (a *App) DestroyManagedLab(instanceID string) (labmanager.State, error) {
	if a.managedLabs == nil {
		return labmanager.State{}, fmt.Errorf("managed lab service is unavailable")
	}
	ctx, cancel := context.WithTimeout(a.commandContext(), managedLabLifecycleTimeout)
	defer cancel()
	instanceID = strings.TrimSpace(instanceID)
	state, err := a.managedLabs.Clean(ctx, instanceID)
	if err == nil {
		a.removeManagedLabWorkspaceAccess(instanceID)
	}
	return state, err
}

func (a *App) OpenManagedLab(instanceID string) error {
	if a.managedLabs == nil {
		return fmt.Errorf("managed lab service is unavailable")
	}
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	instanceID = strings.TrimSpace(instanceID)
	state, err := a.managedLabs.Status(instanceID)
	if err != nil {
		return err
	}
	if state.Phase != "ready" {
		return fmt.Errorf("managed lab instance is not ready")
	}
	launchURL, err := a.managedLabs.LaunchURL(instanceID)
	if err != nil {
		return err
	}
	endpoint, err := url.Parse(launchURL)
	if err != nil ||
		endpoint.Scheme != "http" ||
		endpoint.Hostname() != "127.0.0.1" ||
		endpoint.Port() == "" ||
		endpoint.User != nil ||
		endpoint.RawQuery != "" ||
		(endpoint.Path != "" && !strings.HasPrefix(endpoint.Path, "/")) {
		return fmt.Errorf("managed lab endpoint is not an approved loopback URL")
	}
	origin := (&url.URL{Scheme: endpoint.Scheme, Host: endpoint.Host}).String()
	if origin != state.Endpoint {
		return fmt.Errorf("managed lab launch URL escaped its approved loopback origin")
	}
	wailsruntime.BrowserOpenURL(a.ctx, endpoint.String())
	return nil
}

func (a *App) GetManagedLabAccess(instanceID string) (labmanager.Access, error) {
	if a.managedLabs == nil {
		return labmanager.Access{}, fmt.Errorf("managed lab service is unavailable")
	}
	return a.managedLabs.Access(strings.TrimSpace(instanceID))
}

func (a *App) StartManagedLabTraining(
	instanceID string,
	collaborationMode string,
) (ManagedLabTrainingWorkspace, error) {
	if a.managedLabs == nil {
		return ManagedLabTrainingWorkspace{}, fmt.Errorf("managed lab service is unavailable")
	}
	instanceID = strings.TrimSpace(instanceID)
	state, err := a.managedLabs.Status(instanceID)
	if err != nil {
		return ManagedLabTrainingWorkspace{}, err
	}
	if state.Phase != "ready" {
		return ManagedLabTrainingWorkspace{}, fmt.Errorf("managed lab instance is not ready")
	}
	definition, err := a.managedLabDefinition(state.PackageID)
	if err != nil {
		return ManagedLabTrainingWorkspace{}, err
	}

	projection, found, err := a.findActiveManagedLabTraining(instanceID)
	if err != nil {
		return ManagedLabTrainingWorkspace{}, err
	}
	if !found {
		projection, err = a.ctfJobs.StartChallenge(a.commandContext(), ctf.ChallengeRequest{
			Title:             definition.Title + " · " + definition.Challenge,
			Statement:         "在 MilkSU 管理的本地隔离环境中完成：" + definition.Description,
			Category:          firstManagedLabCategory(definition.Categories),
			CollaborationMode: strings.TrimSpace(collaborationMode),
			DeferAgent:        true,
			TrackName:         "Managed Labs",
			HumanGoal:         definition.Description,
			SourceKind:        "local-lab",
			SourceURI:         state.InstanceID,
			SourceTargets:     append([]securitypolicy.Target{}, state.Scope.Targets...),
			KnowledgePoints:   append([]string{}, definition.Categories...),
		})
		if err != nil {
			return ManagedLabTrainingWorkspace{}, err
		}
	}
	handoff, err := a.PrepareCTFAgentWorkspace(projection.Job.ID)
	if err != nil {
		return ManagedLabTrainingWorkspace{}, err
	}
	if definition.AccessType != "" {
		access, accessErr := a.managedLabs.Access(instanceID)
		if accessErr != nil {
			return ManagedLabTrainingWorkspace{}, accessErr
		}
		accessData, marshalErr := json.MarshalIndent(access, "", "  ")
		if marshalErr != nil {
			return ManagedLabTrainingWorkspace{}, marshalErr
		}
		accessPath := filepath.Join(handoff.WorkspacePath, managedLabAccessFile)
		if writeErr := os.WriteFile(accessPath, accessData, 0o600); writeErr != nil {
			return ManagedLabTrainingWorkspace{}, fmt.Errorf("write managed lab access handoff: %w", writeErr)
		}
		if chmodErr := os.Chmod(accessPath, 0o600); chmodErr != nil {
			return ManagedLabTrainingWorkspace{}, fmt.Errorf("protect managed lab access handoff: %w", chmodErr)
		}
		handoff.Prompt += "\n\n本地训练环境需要临时登录。仅从工作区 lab-access.json 读取登录地址与一次性凭据；不得把凭据写入 notes.md、轨迹摘要、候选或证据。"
		if registerErr := a.ctfAgent.Register(handoff); registerErr != nil {
			return ManagedLabTrainingWorkspace{}, registerErr
		}
	}
	return ManagedLabTrainingWorkspace{Instance: state, CTF: projection, Handoff: handoff}, nil
}

func (a *App) CheckManagedLabTraining(
	instanceID string,
	jobID string,
) (ManagedLabJudgeResponse, error) {
	if a.managedLabs == nil {
		return ManagedLabJudgeResponse{}, fmt.Errorf("managed lab service is unavailable")
	}
	instanceID = strings.TrimSpace(instanceID)
	jobID = strings.TrimSpace(jobID)
	projection, err := a.ctfJobs.GetJob(a.commandContext(), jobID)
	if err != nil {
		return ManagedLabJudgeResponse{}, err
	}
	if projection.Challenge.Source.Kind != "local-lab" ||
		projection.Challenge.Source.URI != instanceID {
		return ManagedLabJudgeResponse{}, fmt.Errorf("CTF job does not match the selected managed lab")
	}

	ctx, cancel := context.WithTimeout(a.commandContext(), managedLabLifecycleTimeout)
	defer cancel()
	result, err := a.managedLabs.Judge(ctx, instanceID)
	if err != nil {
		return ManagedLabJudgeResponse{}, err
	}
	reference := "managed-lab://" + instanceID + "/" + url.PathEscape(result.Challenge)
	recorded, err := a.ctfJobs.RecordAuthorityReceipt(
		a.commandContext(),
		jobID,
		ctf.AuthorityReceiptRequest{
			Evaluator: "milksu-managed-lab",
			Version:   "1",
			Accepted:  result.Solved,
			Summary:   result.Summary,
			Reference: reference,
		},
	)
	if err != nil {
		return ManagedLabJudgeResponse{}, err
	}
	return ManagedLabJudgeResponse{Result: result, CTF: recorded}, nil
}

func (a *App) managedLabDefinition(packageID string) (labmanager.Definition, error) {
	for _, definition := range a.managedLabs.Catalog() {
		if definition.ID == packageID {
			return definition, nil
		}
	}
	return labmanager.Definition{}, fmt.Errorf("managed lab package %q is unavailable", packageID)
}

func (a *App) findActiveManagedLabTraining(instanceID string) (ctf.Projection, bool, error) {
	jobs, err := a.ctfJobs.ListJobs(a.commandContext())
	if err != nil {
		return ctf.Projection{}, false, err
	}
	for _, job := range jobs {
		projection, getErr := a.ctfJobs.GetJob(a.commandContext(), job.ID)
		if getErr != nil {
			return ctf.Projection{}, false, getErr
		}
		if projection.Challenge.Source.Kind == "local-lab" &&
			projection.Challenge.Source.URI == instanceID &&
			projection.Job.Status != securityruntime.JobSucceeded &&
			projection.Job.Status != securityruntime.JobFailed &&
			projection.Job.Status != securityruntime.JobCancelled {
			return projection, true, nil
		}
	}
	return ctf.Projection{}, false, nil
}

func firstManagedLabCategory(categories []string) string {
	if len(categories) == 0 || strings.TrimSpace(categories[0]) == "" {
		return "web"
	}
	return strings.ToLower(strings.TrimSpace(categories[0]))
}

func (a *App) removeManagedLabWorkspaceAccess(instanceID string) {
	if a.ctfJobs == nil || a.dataDirectory == "" {
		return
	}
	jobs, err := a.ctfJobs.ListJobs(a.commandContext())
	if err != nil {
		return
	}
	for _, job := range jobs {
		projection, getErr := a.ctfJobs.GetJob(a.commandContext(), job.ID)
		if getErr != nil ||
			projection.Challenge.Source.Kind != "local-lab" ||
			projection.Challenge.Source.URI != instanceID {
			continue
		}
		workspacePath, pathErr := ctf.AgentWorkspacePath(
			filepath.Join(a.dataDirectory, "ctf-workspaces"),
			projection.Job.ID,
		)
		if pathErr == nil {
			_ = os.Remove(filepath.Join(workspacePath, managedLabAccessFile))
		}
	}
}
