package securityruntime

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"path"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
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
	Image    string `json:"image" yaml:"image"`
	Digest   string `json:"digest" yaml:"digest"`
}

type LabPackageSpec struct {
	Role       string             `json:"role" yaml:"role"`
	Categories []string           `json:"categories" yaml:"categories"`
	Learning   LabLearningSpec    `json:"learning" yaml:"learning"`
	Runtime    LabRuntimeSpec     `json:"runtime" yaml:"runtime"`
	Access     LabAccessSpec      `json:"access,omitempty" yaml:"access,omitempty"`
	Readiness  []LabReadinessSpec `json:"readiness" yaml:"readiness"`
	Reset      LabResetSpec       `json:"reset" yaml:"reset"`
	Judge      LabJudgeSpec       `json:"judge" yaml:"judge"`
	Security   LabSecuritySpec    `json:"security" yaml:"security"`
}

type LabLearningSpec struct {
	Objectives []string `json:"objectives" yaml:"objectives"`
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
	LaunchPath string `json:"launchPath,omitempty" yaml:"launchPath,omitempty"`
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

type LabAccessSpec struct {
	Type      string `json:"type,omitempty" yaml:"type,omitempty"`
	LoginPath string `json:"loginPath,omitempty" yaml:"loginPath,omitempty"`
	StateFile string `json:"stateFile,omitempty" yaml:"stateFile,omitempty"`
}

type LabJudgeSpec struct {
	Type                string   `json:"type" yaml:"type"`
	Ref                 string   `json:"ref,omitempty" yaml:"ref,omitempty"`
	Challenge           string   `json:"challenge,omitempty" yaml:"challenge,omitempty"`
	Endpoint            string   `json:"endpoint,omitempty" yaml:"endpoint,omitempty"`
	ResponseContract    string   `json:"responseContract,omitempty" yaml:"responseContract,omitempty"`
	ExpectedAssignments []string `json:"expectedAssignments,omitempty" yaml:"expectedAssignments,omitempty"`
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

// ParseLabPackage strictly decodes one YAML LabPackage document and validates
// the complete v1alpha1 contract. Unknown fields and trailing documents are
// rejected so an installed package cannot silently bypass a misspelled safety
// property.
func ParseLabPackage(data []byte) (LabPackage, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(data))
	decoder.KnownFields(true)

	var packageValue LabPackage
	if err := decoder.Decode(&packageValue); err != nil {
		if err == io.EOF {
			return LabPackage{}, fmt.Errorf("lab package YAML is empty")
		}
		return LabPackage{}, fmt.Errorf("decode lab package YAML: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return LabPackage{}, fmt.Errorf("lab package YAML must contain exactly one document")
		}
		return LabPackage{}, fmt.Errorf("decode trailing lab package YAML: %w", err)
	}
	if err := packageValue.Validate(); err != nil {
		return LabPackage{}, err
	}
	return packageValue, nil
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
	sourceURL, err := url.Parse(strings.TrimSpace(p.Metadata.Source.URL))
	if err != nil || (sourceURL.Scheme != "https" && sourceURL.Scheme != "http") || sourceURL.Host == "" || sourceURL.User != nil {
		return fmt.Errorf("lab source URL must be an http(s) URL without credentials")
	}
	if strings.TrimSpace(p.Metadata.Source.Revision) == "" || strings.TrimSpace(p.Metadata.Source.Image) == "" || strings.ContainsAny(p.Metadata.Source.Image, " \t\r\n@") || !validSHA256(p.Metadata.Source.Digest) {
		return fmt.Errorf("pinned lab source revision, image, and sha256 digest are required")
	}
	if p.Spec.Role != "ctf" && p.Spec.Role != "vuln" {
		return fmt.Errorf("lab role must be ctf or vuln")
	}
	if len(p.Spec.Categories) == 0 || len(p.Spec.Learning.Objectives) == 0 {
		return fmt.Errorf("lab categories and learning objectives are required")
	}
	for _, objective := range p.Spec.Learning.Objectives {
		if strings.TrimSpace(objective) == "" {
			return fmt.Errorf("lab learning objectives cannot be empty")
		}
	}
	if p.Spec.Runtime.Provider != "compose" && p.Spec.Runtime.Provider != "oci" {
		return fmt.Errorf("lab runtime provider must be compose or oci")
	}
	if !safePackagePath(p.Spec.Runtime.Entry) || len(p.Spec.Runtime.Platforms) == 0 || len(p.Spec.Runtime.Endpoints) == 0 {
		return fmt.Errorf("lab runtime entry, platform, and endpoint are required")
	}
	for _, platform := range p.Spec.Runtime.Platforms {
		if platform != "linux/amd64" && platform != "linux/arm64" {
			return fmt.Errorf("unsupported lab platform %q", platform)
		}
	}
	endpoints := make(map[string]struct{}, len(p.Spec.Runtime.Endpoints))
	for _, endpoint := range p.Spec.Runtime.Endpoints {
		if endpoint.Name == "" || endpoint.Service == "" || endpoint.TargetPort < 1 || endpoint.TargetPort > 65535 {
			return fmt.Errorf("invalid lab endpoint")
		}
		if endpoint.Protocol != "http" && endpoint.Protocol != "https" && endpoint.Protocol != "tcp" {
			return fmt.Errorf("unsupported lab endpoint protocol %q", endpoint.Protocol)
		}
		if endpoint.Publish != "loopback-ephemeral" {
			return fmt.Errorf("lab endpoints must use loopback-ephemeral publishing")
		}
		if endpoint.LaunchPath != "" && !safeLaunchPath(endpoint.LaunchPath) {
			return fmt.Errorf("invalid lab endpoint launch path")
		}
		if _, exists := endpoints[endpoint.Name]; exists {
			return fmt.Errorf("duplicate lab endpoint %q", endpoint.Name)
		}
		endpoints[endpoint.Name] = struct{}{}
	}
	if p.Spec.Runtime.Network.Ingress != "loopback" || p.Spec.Runtime.Network.Egress != "deny" {
		return fmt.Errorf("v1alpha1 labs require loopback ingress and denied egress")
	}
	switch p.Spec.Access.Type {
	case "":
		if p.Spec.Access.LoginPath != "" || p.Spec.Access.StateFile != "" {
			return fmt.Errorf("lab access fields require an access type")
		}
	case "form":
		if !safeEndpointPath(p.Spec.Access.LoginPath) ||
			!safePackagePath(p.Spec.Access.StateFile) ||
			strings.Contains(p.Spec.Access.StateFile, "/") {
			return fmt.Errorf("form access requires a login path and private state filename")
		}
	default:
		return fmt.Errorf("unsupported lab access type %q", p.Spec.Access.Type)
	}
	if len(p.Spec.Readiness) == 0 {
		return fmt.Errorf("lab readiness is required")
	}
	for _, readiness := range p.Spec.Readiness {
		if readiness.Type != "http" {
			return fmt.Errorf("unsupported lab readiness type %q", readiness.Type)
		}
		if _, exists := endpoints[readiness.Endpoint]; !exists {
			return fmt.Errorf("lab readiness references unknown endpoint %q", readiness.Endpoint)
		}
		if !safeEndpointPath(readiness.Path) {
			return fmt.Errorf("invalid lab readiness path")
		}
		timeout, err := time.ParseDuration(readiness.Timeout)
		if err != nil || timeout <= 0 {
			return fmt.Errorf("invalid lab readiness timeout")
		}
	}
	if p.Spec.Reset.Strategy != "recreate-with-volumes" {
		return fmt.Errorf("unsupported lab reset strategy %q", p.Spec.Reset.Strategy)
	}
	switch p.Spec.Judge.Type {
	case "application-oracle":
		if strings.TrimSpace(p.Spec.Judge.Challenge) == "" || !safeEndpointPath(p.Spec.Judge.Endpoint) {
			return fmt.Errorf("application-oracle judge requires a challenge and endpoint")
		}
		switch p.Spec.Judge.ResponseContract {
		case "":
			if len(p.Spec.Judge.ExpectedAssignments) != 0 {
				return fmt.Errorf("expected assignments require a response contract")
			}
		case "json-assignment-set":
			if p.Spec.Access.Type != "form" || len(p.Spec.Judge.ExpectedAssignments) == 0 {
				return fmt.Errorf("json-assignment-set judge requires form access and expected assignments")
			}
			seenAssignments := make(map[string]struct{}, len(p.Spec.Judge.ExpectedAssignments))
			for _, assignment := range p.Spec.Judge.ExpectedAssignments {
				if err := validateIdentifier("expected assignment", assignment); err != nil {
					return err
				}
				if _, exists := seenAssignments[assignment]; exists {
					return fmt.Errorf("duplicate expected assignment %q", assignment)
				}
				seenAssignments[assignment] = struct{}{}
			}
		default:
			return fmt.Errorf("unsupported application oracle response contract %q", p.Spec.Judge.ResponseContract)
		}
	case "flag":
		if !safePackagePath(p.Spec.Judge.Ref) {
			return fmt.Errorf("flag judge requires a safe package-relative ref")
		}
	default:
		return fmt.Errorf("unsupported lab judge type %q", p.Spec.Judge.Type)
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

func safePackagePath(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && !path.IsAbs(value) && path.Clean(value) == value && value != "." && !strings.HasPrefix(value, "../") && !strings.ContainsAny(value, "\x00\r\n")
}

func safeEndpointPath(value string) bool {
	return strings.HasPrefix(value, "/") && !strings.ContainsAny(value, "\x00\r\n?#")
}

func safeLaunchPath(value string) bool {
	if !strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\x00\r\n?") {
		return false
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.User != nil || parsed.RawQuery != "" {
		return false
	}
	cleaned := path.Clean(parsed.Path)
	return cleaned == parsed.Path && !strings.HasPrefix(cleaned, "../")
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
