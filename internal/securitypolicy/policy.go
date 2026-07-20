package securitypolicy

import (
	"fmt"
	"net"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

type TargetKind string

const (
	TargetOrigin     TargetKind = "origin"
	TargetDirectory  TargetKind = "directory"
	TargetSocket     TargetKind = "socket"
	TargetLab        TargetKind = "lab"
	TargetBrowserTab TargetKind = "browser_tab"
)

type Target struct {
	Kind  TargetKind `json:"kind"`
	Value string     `json:"value"`
}

// ScopeGrant is an immutable user authorization envelope. Models may consume
// it but cannot create, extend, or renew it.
type ScopeGrant struct {
	ID        string     `json:"id"`
	Source    string     `json:"source"`
	Purpose   string     `json:"purpose"`
	Targets   []Target   `json:"targets"`
	GrantedBy string     `json:"grantedBy"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	Revocable bool       `json:"revocable"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
}

type EffectRequest struct {
	Class    string `json:"class"`
	Target   Target `json:"target"`
	Approved bool   `json:"approved"`
}

type PolicyDecision struct {
	Allowed          bool   `json:"allowed"`
	Reason           string `json:"reason"`
	RequiresApproval bool   `json:"requiresApproval"`
	RateClass        string `json:"rateClass"`
}

func NewGrant(source, purpose string, targets []Target, ttl time.Duration) (ScopeGrant, error) {
	if ttl <= 0 || ttl > 30*24*time.Hour {
		return ScopeGrant{}, fmt.Errorf("scope duration must be between one nanosecond and 30 days")
	}
	now := time.Now().UTC()
	grant := ScopeGrant{
		ID: "scope_" + uuid.NewString(), Source: strings.TrimSpace(source), Purpose: strings.TrimSpace(purpose),
		Targets: append([]Target{}, targets...), GrantedBy: "local-user", CreatedAt: now,
		ExpiresAt: now.Add(ttl), Revocable: true,
	}
	if err := grant.Validate(now); err != nil {
		return ScopeGrant{}, err
	}
	return grant, nil
}

func (g ScopeGrant) Validate(now time.Time) error {
	if !strings.HasPrefix(g.ID, "scope_") || g.Source == "" || g.Purpose == "" || g.GrantedBy != "local-user" {
		return fmt.Errorf("scope identity, source, purpose, and local grantor are required")
	}
	if len(g.Targets) == 0 || len(g.Targets) > 16 {
		return fmt.Errorf("scope must contain between 1 and 16 exact targets")
	}
	if g.CreatedAt.IsZero() || g.ExpiresAt.IsZero() || !g.ExpiresAt.After(g.CreatedAt) {
		return fmt.Errorf("scope timestamps are invalid")
	}
	if g.ExpiresAt.Sub(g.CreatedAt) > 30*24*time.Hour {
		return fmt.Errorf("scope may not exceed 30 days")
	}
	if g.RevokedAt != nil || !now.Before(g.ExpiresAt) {
		return fmt.Errorf("scope is revoked or expired")
	}
	seen := make(map[string]struct{}, len(g.Targets))
	for _, target := range g.Targets {
		normalized, err := NormalizeTarget(target)
		if err != nil {
			return err
		}
		key := string(normalized.Kind) + "\x00" + normalized.Value
		if _, exists := seen[key]; exists {
			return fmt.Errorf("scope contains a duplicate target")
		}
		seen[key] = struct{}{}
	}
	return nil
}

func NormalizeTarget(target Target) (Target, error) {
	value := strings.TrimSpace(target.Value)
	if value == "" || len(value) > 2048 {
		return Target{}, fmt.Errorf("scope target is empty or too long")
	}
	switch target.Kind {
	case TargetOrigin:
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
			return Target{}, fmt.Errorf("origin target must be an http(s) URL without credentials")
		}
		return Target{Kind: TargetOrigin, Value: parsed.Scheme + "://" + parsed.Host}, nil
	case TargetDirectory:
		if !filepath.IsAbs(value) {
			return Target{}, fmt.Errorf("directory target must be an absolute user-selected path")
		}
		cleaned := filepath.Clean(value)
		if cleaned == string(filepath.Separator) {
			return Target{}, fmt.Errorf("filesystem root cannot be granted")
		}
		return Target{Kind: TargetDirectory, Value: cleaned}, nil
	case TargetSocket:
		host, port, err := net.SplitHostPort(value)
		if err != nil || strings.TrimSpace(host) == "" || strings.TrimSpace(port) == "" {
			return Target{}, fmt.Errorf("socket target must be an exact host:port")
		}
		return Target{Kind: TargetSocket, Value: net.JoinHostPort(host, port)}, nil
	case TargetLab, TargetBrowserTab:
		if strings.ContainsAny(value, "\x00\r\n") {
			return Target{}, fmt.Errorf("target contains control characters")
		}
		return Target{Kind: target.Kind, Value: value}, nil
	default:
		return Target{}, fmt.Errorf("unsupported scope target kind %q", target.Kind)
	}
}

func Decide(grant ScopeGrant, request EffectRequest, now time.Time) PolicyDecision {
	if err := grant.Validate(now); err != nil {
		return PolicyDecision{Reason: err.Error()}
	}
	requested, err := NormalizeTarget(request.Target)
	if err != nil {
		return PolicyDecision{Reason: err.Error()}
	}
	if !containsTarget(grant.Targets, requested) {
		return PolicyDecision{Reason: "requested target is outside the user-granted scope"}
	}
	switch request.Class {
	case "read_local", "read_remote":
		return PolicyDecision{Allowed: true, Reason: "read-only action is inside scope", RateClass: "read"}
	case "limited_interaction":
		return PolicyDecision{Allowed: true, Reason: "bounded interaction is inside scope", RateClass: "interactive"}
	case "submit", "authenticate", "modify", "execute":
		if !request.Approved {
			return PolicyDecision{Reason: "explicit approval is required for this effect", RequiresApproval: true, RateClass: "sensitive"}
		}
		return PolicyDecision{Allowed: true, Reason: "explicitly approved effect is inside scope", RequiresApproval: true, RateClass: "sensitive"}
	default:
		return PolicyDecision{Reason: "unknown effect class is denied by default"}
	}
}

func containsTarget(values []Target, requested Target) bool {
	for _, raw := range values {
		value, err := NormalizeTarget(raw)
		if err != nil || value.Kind != requested.Kind {
			continue
		}
		if value.Value == requested.Value {
			return true
		}
		if value.Kind == TargetDirectory {
			relative, err := filepath.Rel(value.Value, requested.Value)
			if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
				return true
			}
		}
	}
	return false
}
