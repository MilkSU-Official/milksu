package securityruntime

import (
	"encoding/hex"
	"fmt"
	"strings"
)

const LabPackageAPIVersion = "labs.milksu.dev/v1alpha1"

type LabPackage struct {
	APIVersion string         `json:"apiVersion" yaml:"apiVersion"`
	Kind       string         `json:"kind" yaml:"kind"`
	Metadata   LabMetadata    `json:"metadata" yaml:"metadata"`
	Spec       LabPackageSpec `json:"spec" yaml:"spec"`
}

type LabMetadata struct {
	ID      string    `json:"id" yaml:"id"`
	Title   string    `json:"title" yaml:"title"`
	Version string    `json:"version" yaml:"version"`
	License string    `json:"license" yaml:"license"`
	Source  LabSource `json:"source" yaml:"source"`
}

type LabSource struct {
	URL      string `json:"url" yaml:"url"`
	Revision string `json:"revision" yaml:"revision"`
	Digest   string `json:"digest" yaml:"digest"`
}

type LabPackageSpec struct {
	Role       string             `json:"role" yaml:"role"`
	Categories []string           `json:"categories" yaml:"categories"`
	Runtime    LabRuntimeSpec     `json:"runtime" yaml:"runtime"`
	Readiness  []LabReadinessSpec `json:"readiness" yaml:"readiness"`
	Reset      LabResetSpec       `json:"reset" yaml:"reset"`
	Judge      LabJudgeSpec       `json:"judge" yaml:"judge"`
	Security   LabSecuritySpec    `json:"security" yaml:"security"`
}

type LabRuntimeSpec struct {
	Provider  string            `json:"provider" yaml:"provider"`
	Entry     string            `json:"entry" yaml:"entry"`
	Platforms []string          `json:"platforms" yaml:"platforms"`
	Endpoints []LabEndpointSpec `json:"endpoints" yaml:"endpoints"`
	Network   LabNetworkSpec    `json:"network" yaml:"network"`
}

type LabEndpointSpec struct {
	Name       string `json:"name" yaml:"name"`
	Service    string `json:"service" yaml:"service"`
	TargetPort int    `json:"targetPort" yaml:"targetPort"`
	Protocol   string `json:"protocol" yaml:"protocol"`
	Publish    string `json:"publish" yaml:"publish"`
}

type LabNetworkSpec struct {
	Ingress string `json:"ingress" yaml:"ingress"`
	Egress  string `json:"egress" yaml:"egress"`
}

type LabReadinessSpec struct {
	Type     string `json:"type" yaml:"type"`
	Endpoint string `json:"endpoint" yaml:"endpoint"`
	Path     string `json:"path" yaml:"path"`
	Timeout  string `json:"timeout" yaml:"timeout"`
}

type LabResetSpec struct {
	Strategy string `json:"strategy" yaml:"strategy"`
}

type LabJudgeSpec struct {
	Type string `json:"type" yaml:"type"`
	Ref  string `json:"ref" yaml:"ref"`
}

type LabSecuritySpec struct {
	Privileged   bool     `json:"privileged" yaml:"privileged"`
	HostNetwork  bool     `json:"hostNetwork" yaml:"hostNetwork"`
	DockerSocket bool     `json:"dockerSocket" yaml:"dockerSocket"`
	HostMounts   []string `json:"hostMounts" yaml:"hostMounts"`
}

type LabAction string

const (
	LabStart  LabAction = "lab.start"
	LabReset  LabAction = "lab.reset"
	LabStop   LabAction = "lab.stop"
	LabSubmit LabAction = "lab.submit"
)

type LabRequest struct {
	Action     LabAction `json:"action"`
	PackageID  string    `json:"packageId"`
	InstanceID string    `json:"instanceId,omitempty"`
	Submission string    `json:"submission,omitempty"`
}

func (p LabPackage) Validate() error {
	if p.APIVersion != LabPackageAPIVersion || p.Kind != "LabPackage" {
		return fmt.Errorf("unsupported lab package contract")
	}
	if err := validateIdentifier("lab package id", p.Metadata.ID); err != nil {
		return err
	}
	if strings.TrimSpace(p.Metadata.Title) == "" || strings.TrimSpace(p.Metadata.Version) == "" || strings.TrimSpace(p.Metadata.License) == "" {
		return fmt.Errorf("lab metadata title, version, and license are required")
	}
	if p.Metadata.Source.URL == "" || p.Metadata.Source.Revision == "" || !validSHA256(p.Metadata.Source.Digest) {
		return fmt.Errorf("pinned lab source URL, revision, and sha256 digest are required")
	}
	if p.Spec.Role != "ctf" && p.Spec.Role != "vuln" {
		return fmt.Errorf("lab role must be ctf or vuln")
	}
	if p.Spec.Runtime.Provider != "compose" && p.Spec.Runtime.Provider != "oci" {
		return fmt.Errorf("lab runtime provider must be compose or oci")
	}
	if p.Spec.Runtime.Entry == "" || len(p.Spec.Runtime.Platforms) == 0 || len(p.Spec.Runtime.Endpoints) == 0 {
		return fmt.Errorf("lab runtime entry, platform, and endpoint are required")
	}
	for _, endpoint := range p.Spec.Runtime.Endpoints {
		if endpoint.Name == "" || endpoint.Service == "" || endpoint.TargetPort < 1 || endpoint.TargetPort > 65535 {
			return fmt.Errorf("invalid lab endpoint")
		}
		if endpoint.Publish != "loopback-ephemeral" {
			return fmt.Errorf("lab endpoints must use loopback-ephemeral publishing")
		}
	}
	if p.Spec.Runtime.Network.Ingress != "loopback" || p.Spec.Runtime.Network.Egress != "deny" {
		return fmt.Errorf("v1alpha1 labs require loopback ingress and denied egress")
	}
	if len(p.Spec.Readiness) == 0 || p.Spec.Reset.Strategy == "" || p.Spec.Judge.Type == "" || p.Spec.Judge.Ref == "" {
		return fmt.Errorf("lab readiness, reset, and judge are required")
	}
	if p.Spec.Security.Privileged || p.Spec.Security.HostNetwork || p.Spec.Security.DockerSocket || len(p.Spec.Security.HostMounts) > 0 {
		return fmt.Errorf("unsafe lab privileges are not allowed in v1alpha1")
	}
	return nil
}

func validSHA256(value string) bool {
	if !strings.HasPrefix(value, "sha256:") {
		return false
	}
	digest := strings.TrimPrefix(value, "sha256:")
	if len(digest) != 64 {
		return false
	}
	_, err := hex.DecodeString(digest)
	return err == nil
}

func (request LabRequest) Validate() error {
	if err := validateIdentifier("lab package id", request.PackageID); err != nil {
		return err
	}
	switch request.Action {
	case LabStart:
		if request.InstanceID != "" || request.Submission != "" {
			return fmt.Errorf("lab.start accepts only a package id")
		}
	case LabReset, LabStop:
		if err := validateIdentifier("lab instance id", request.InstanceID); err != nil {
			return err
		}
		if request.Submission != "" {
			return fmt.Errorf("%s does not accept a submission", request.Action)
		}
	case LabSubmit:
		if err := validateIdentifier("lab instance id", request.InstanceID); err != nil {
			return err
		}
		if strings.TrimSpace(request.Submission) == "" {
			return fmt.Errorf("lab.submit requires a submission")
		}
	default:
		return fmt.Errorf("unsupported lab action")
	}
	return nil
}
