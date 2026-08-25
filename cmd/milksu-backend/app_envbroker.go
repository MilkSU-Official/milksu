package main

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/envbroker"
)

type envOwnerRequest struct {
	OwnerKind string `json:"ownerKind"`
	OwnerID   string `json:"ownerId"`
	PackageID string `json:"packageId,omitempty"`
}

func (a *App) ListLabPackages() []envbroker.Package {
	if a.envBroker == nil {
		return envbroker.Catalog()
	}
	return a.envBroker.Catalog()
}

func (a *App) ListEnvLeases() []envbroker.Lease {
	if a.envBroker == nil {
		return nil
	}
	leases := a.envBroker.List()
	for i := range leases {
		leases[i] = a.decorateLease(leases[i])
	}
	return leases
}

func (a *App) GetEnvLease(request envOwnerRequest) envbroker.Lease {
	if a.envBroker == nil {
		return envbroker.Lease{State: "none", OwnerKind: request.OwnerKind, OwnerID: request.OwnerID}
	}
	return a.decorateLease(a.envBroker.Status(a.commandContext(), envbroker.Owner{Kind: request.OwnerKind, ID: request.OwnerID}))
}

type envCVEPackage struct {
	Found   bool              `json:"found"`
	Package envbroker.Package `json:"package"`
}

func (a *App) GetEnvPackageForCVE(cveID string) envCVEPackage {
	item, found := envbroker.PackageForCVE(cveID)
	return envCVEPackage{Found: found, Package: item}
}

func (a *App) StartEnvLease(request envOwnerRequest) (envbroker.Lease, error) {
	if a.envBroker == nil {
		return envbroker.Lease{State: "failed", Error: "环境经纪不可用"}, nil
	}
	lease, err := a.envBroker.Start(a.commandContext(), envbroker.Owner{Kind: request.OwnerKind, ID: request.OwnerID}, request.PackageID)
	return a.decorateLease(lease), err
}

func (a *App) StopEnvLease(request envOwnerRequest) (envbroker.Lease, error) {
	if a.envBroker == nil {
		return envbroker.Lease{State: "none"}, nil
	}
	lease, err := a.envBroker.Stop(a.commandContext(), envbroker.Owner{Kind: request.OwnerKind, ID: request.OwnerID})
	return a.decorateLease(lease), err
}

func (a *App) ResetEnvLease(request envOwnerRequest) (envbroker.Lease, error) {
	if a.envBroker == nil {
		return envbroker.Lease{State: "none"}, nil
	}
	lease, err := a.envBroker.Reset(a.commandContext(), envbroker.Owner{Kind: request.OwnerKind, ID: request.OwnerID})
	return a.decorateLease(lease), err
}

func (a *App) decorateLease(lease envbroker.Lease) envbroker.Lease {
	if strings.TrimSpace(lease.OccupyOwner) == "" {
		return lease
	}
	kind, id, ok := strings.Cut(lease.OccupyOwner, ":")
	if !ok {
		return lease
	}
	switch kind {
	case "lab":
		if a.labJobs != nil {
			if job, err := a.labJobs.Get(id); err == nil && strings.TrimSpace(job.Title) != "" {
				lease.OccupyTitle = job.Title
			}
		}
	case "cve":
		lease.OccupyTitle = id
	}
	if strings.TrimSpace(lease.OccupyTitle) == "" {
		lease.OccupyTitle = lease.OccupyOwner
	}
	return lease
}

func (a *App) ProbeEnvLease(request envOwnerRequest) (string, error) {
	if a.envBroker == nil {
		return "", nil
	}
	return a.envBroker.Probe(a.commandContext(), envbroker.Owner{Kind: request.OwnerKind, ID: request.OwnerID})
}

type labEnvironmentProbe struct {
	AndroidSDK     string `json:"androidSdk"`
	JavaHome       string `json:"javaHome"`
	AutoCreateAVD  bool   `json:"autoCreateAvd"`
}

func (a *App) GetLabEnvironmentStatus(probe labEnvironmentProbe) envbroker.AndroidToolingStatus {
	tooling := envbroker.AndroidTooling{
		SDKRoot:       probe.AndroidSDK,
		JavaHome:      probe.JavaHome,
		AutoCreateAVD: probe.AutoCreateAVD,
	}
	if a.settings != nil && strings.TrimSpace(probe.AndroidSDK) == "" && strings.TrimSpace(probe.JavaHome) == "" {
		if lab := a.settings.Get().Lab; lab != nil {
			if tooling.SDKRoot == "" {
				tooling.SDKRoot = lab.AndroidSDK
			}
			if tooling.JavaHome == "" {
				tooling.JavaHome = lab.JavaHome
			}
			if lab.AutoCreateAVD != nil {
				tooling.AutoCreateAVD = *lab.AutoCreateAVD
			}
		}
	}
	return envbroker.ProbeAndroidTooling(tooling)
}

func (a *App) OpenAndroidStudioSetup() error {
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	if path := envbroker.AndroidStudioLaunchPath(); path != "" {
		if runtime.GOOS == "darwin" {
			if err := exec.Command("open", path).Start(); err == nil {
				return nil
			}
		} else if err := exec.Command(path).Start(); err == nil {
			return nil
		}
	}
	return a.openExternal(envbroker.AndroidStudioInstallURL)
}

func (a *App) ChooseLabPath(kind string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("desktop runtime is not ready")
	}
	title := "选择 Android SDK 目录"
	if strings.TrimSpace(kind) == "java" {
		title = "选择 JDK 目录"
	}
	return a.openDirectory(desktopDialogOptions{Title: title})
}

func (a *App) OpenDockerDesktop() error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", "-a", "Docker").Start()
	case "windows":
		return exec.Command("cmd", "/c", "start", "", "Docker Desktop").Start()
	default:
		if path, err := exec.LookPath("systemctl"); err == nil {
			return exec.Command(path, "--user", "start", "docker-desktop").Start()
		}
		return fmt.Errorf("请手动启动 Docker")
	}
}

func (a *App) envOwnerFromConversation(conversationID string) (envbroker.Owner, error) {
	if a.conversations == nil {
		return envbroker.Owner{}, fmt.Errorf("当前会话没有环境作业")
	}
	saved, err := a.conversations.Get(conversationID)
	if err != nil {
		return envbroker.Owner{}, err
	}
	if saved.DomainTaskContext == nil {
		return envbroker.Owner{}, fmt.Errorf("当前会话没有环境作业")
	}
	kind, _ := saved.DomainTaskContext["kind"].(string)
	switch strings.TrimSpace(kind) {
	case "lab":
		id, _ := saved.DomainTaskContext["jobId"].(string)
		id = strings.TrimSpace(id)
		if id == "" {
			return envbroker.Owner{}, fmt.Errorf("当前会话没有实验室作业")
		}
		return envbroker.Owner{Kind: "lab", ID: id}, nil
	case "cve":
		id, _ := saved.DomainTaskContext["cveId"].(string)
		id = strings.ToUpper(strings.TrimSpace(id))
		if id == "" {
			return envbroker.Owner{}, fmt.Errorf("当前会话没有 CVE 档案")
		}
		return envbroker.Owner{Kind: "cve", ID: id}, nil
	default:
		return envbroker.Owner{}, fmt.Errorf("当前会话没有环境作业")
	}
}

func (a *App) boundPackageID(owner envbroker.Owner) string {
	lease := envbroker.Lease{}
	if a.envBroker != nil {
		lease = a.envBroker.Get(owner)
		if strings.TrimSpace(lease.PackageID) != "" {
			return lease.PackageID
		}
	}
	if owner.Kind == "lab" && a.labJobs != nil {
		if job, err := a.labJobs.Get(owner.ID); err == nil && strings.TrimSpace(job.PackageID) != "" {
			return job.PackageID
		}
	}
	if owner.Kind == "cve" {
		if item, ok := envbroker.PackageForCVE(owner.ID); ok {
			return item.ID
		}
	}
	return ""
}

func (a *App) handleEnvWorkspaceAction(conversationID, action string) (string, error) {
	if a.envBroker == nil {
		return "", fmt.Errorf("环境经纪不可用")
	}
	owner, err := a.envOwnerFromConversation(conversationID)
	if err != nil {
		return "", err
	}
	switch action {
	case "env_status":
		lease := a.decorateLease(a.envBroker.Status(a.commandContext(), owner))
		return encodeWorkspaceResult(lease)
	case "env_start":
		packageID := a.boundPackageID(owner)
		if packageID == "" {
			return "", fmt.Errorf("没有绑定练习包。请用户在环境条启动")
		}
		lease, startErr := a.envBroker.Start(a.commandContext(), owner, packageID)
		if startErr != nil {
			return encodeWorkspaceResult(a.decorateLease(lease))
		}
		return encodeWorkspaceResult(a.decorateLease(lease))
	case "env_reset":
		lease, resetErr := a.envBroker.Reset(a.commandContext(), owner)
		if resetErr != nil {
			return encodeWorkspaceResult(a.decorateLease(lease))
		}
		return encodeWorkspaceResult(a.decorateLease(lease))
	case "env_stop":
		lease, stopErr := a.envBroker.Stop(a.commandContext(), owner)
		if stopErr != nil {
			return encodeWorkspaceResult(a.decorateLease(lease))
		}
		return encodeWorkspaceResult(a.decorateLease(lease))
	default:
		return "", fmt.Errorf("unknown environment action")
	}
}
