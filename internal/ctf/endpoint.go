package ctf

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

const dynamicEndpointScopeTTL = 8 * time.Hour

type endpointDecision struct {
	RequestID string                     `json:"requestId"`
	Status    EndpointRequestStatus      `json:"status"`
	Scope     *securitypolicy.ScopeGrant `json:"scope,omitempty"`
	DecidedAt time.Time                  `json:"decidedAt"`
}

func (s *Service) RequestDynamicEndpoint(
	ctx context.Context,
	jobID string,
	input EndpointRequestInput,
	requestedBy EndpointRequester,
) (Projection, error) {
	s.endpointMu.Lock()
	defer s.endpointMu.Unlock()

	projection, err := s.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	if err := requireMutableEndpointJob(projection); err != nil {
		return Projection{}, err
	}
	request, err := normalizeEndpointRequest(input, requestedBy)
	if err != nil {
		return Projection{}, err
	}
	now := time.Now().UTC()
	if endpointTargetIsActive(projection.Challenge.Source.Scope, request.Target, now) {
		return Projection{}, fmt.Errorf("endpoint is already authorized by the challenge source scope")
	}
	for _, scope := range projection.NetworkScopes {
		if endpointTargetIsActive(scope, request.Target, now) {
			return Projection{}, fmt.Errorf("endpoint already has an active user-granted scope")
		}
	}
	for _, existing := range projection.EndpointRequests {
		if existing.Status == EndpointRequestPending &&
			existing.Protocol == request.Protocol &&
			existing.Target == request.Target {
			return projection, nil
		}
	}
	request.ID = securityruntime.NewIdentifier("endpoint")
	request.RequestedAt = now
	data, err := json.Marshal(request)
	if err != nil {
		return Projection{}, fmt.Errorf("encode endpoint request: %w", err)
	}
	if err := s.runtime.CommitRoleFact(ctx, securityruntime.EventScope{JobID: jobID}, securityruntime.RoleFact{
		ID: securityruntime.NewIdentifier("fact"), PackageID: PackageID, SchemaVersion: SchemaVersion,
		Kind: FactEndpointRequested, Data: data,
	}); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}

func (s *Service) DecideDynamicEndpoint(
	ctx context.Context,
	jobID, requestID string,
	approved bool,
) (Projection, error) {
	s.endpointMu.Lock()
	defer s.endpointMu.Unlock()

	projection, err := s.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	if err := requireMutableEndpointJob(projection); err != nil {
		return Projection{}, err
	}
	var request *EndpointRequest
	for index := range projection.EndpointRequests {
		if projection.EndpointRequests[index].ID == strings.TrimSpace(requestID) {
			request = &projection.EndpointRequests[index]
			break
		}
	}
	if request == nil {
		return Projection{}, fmt.Errorf("endpoint request does not belong to the CTF job")
	}
	if request.Status != EndpointRequestPending {
		return Projection{}, fmt.Errorf("endpoint request has already been decided")
	}
	decision := endpointDecision{
		RequestID: request.ID,
		Status:    EndpointRequestDenied,
	}
	if approved {
		grant, err := securitypolicy.NewGrant(
			"ctf-endpoint:"+request.ID,
			request.Purpose,
			[]securitypolicy.Target{request.Target},
			dynamicEndpointScopeTTL,
		)
		if err != nil {
			return Projection{}, err
		}
		decision.Status = EndpointRequestApproved
		decision.Scope = &grant
	}
	decision.DecidedAt = time.Now().UTC()
	data, err := json.Marshal(decision)
	if err != nil {
		return Projection{}, fmt.Errorf("encode endpoint decision: %w", err)
	}
	if err := s.runtime.CommitRoleFact(ctx, securityruntime.EventScope{JobID: jobID}, securityruntime.RoleFact{
		ID: securityruntime.NewIdentifier("fact"), PackageID: PackageID, SchemaVersion: SchemaVersion,
		Kind: FactEndpointDecided, Data: data,
	}); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}

func requireMutableEndpointJob(projection Projection) error {
	if projection.Job.Role != PackageID {
		return fmt.Errorf("job is not a CTF challenge")
	}
	switch projection.Job.Status {
	case securityruntime.JobSucceeded, securityruntime.JobFailed, securityruntime.JobCancelled:
		return fmt.Errorf("completed CTF jobs cannot change endpoint authorization")
	}
	if projection.Outcome != nil {
		return fmt.Errorf("completed CTF jobs cannot change endpoint authorization")
	}
	return nil
}

func normalizeEndpointRequest(
	input EndpointRequestInput,
	requestedBy EndpointRequester,
) (EndpointRequest, error) {
	protocol := EndpointProtocol(strings.ToLower(strings.TrimSpace(string(input.Protocol))))
	switch requestedBy {
	case EndpointRequesterUser, EndpointRequesterAgent, EndpointRequesterPage:
	default:
		return EndpointRequest{}, fmt.Errorf("endpoint requester must be user, agent, or page")
	}
	source, err := boundedEndpointText("endpoint source", input.Source, 240)
	if err != nil {
		return EndpointRequest{}, err
	}
	purpose, err := boundedEndpointText("endpoint purpose", input.Purpose, 500)
	if err != nil {
		return EndpointRequest{}, err
	}
	rawEndpoint := strings.TrimSpace(input.Endpoint)
	var target securitypolicy.Target
	switch protocol {
	case EndpointProtocolHTTP, EndpointProtocolHTTPS:
		parsed, err := url.Parse(rawEndpoint)
		if err != nil ||
			parsed.Scheme != string(protocol) ||
			parsed.Host == "" ||
			parsed.User != nil ||
			(parsed.Path != "" && parsed.Path != "/") ||
			parsed.RawQuery != "" ||
			parsed.Fragment != "" {
			return EndpointRequest{}, fmt.Errorf("%s endpoint must be an exact origin without credentials, path, query, or fragment", protocol)
		}
		host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
		if host == "" {
			return EndpointRequest{}, fmt.Errorf("%s endpoint must include a host", protocol)
		}
		port := parsed.Port()
		if port == "" {
			if protocol == EndpointProtocolHTTPS {
				port = "443"
			} else {
				port = "80"
			}
		}
		portNumber, err := strconv.Atoi(port)
		if err != nil || portNumber < 1 || portNumber > 65535 {
			return EndpointRequest{}, fmt.Errorf("%s endpoint must include a valid port", protocol)
		}
		authority := host
		if strings.Contains(host, ":") {
			authority = "[" + host + "]"
		}
		if parsed.Port() != "" &&
			(protocol != EndpointProtocolHTTP || portNumber != 80) &&
			(protocol != EndpointProtocolHTTPS || portNumber != 443) {
			authority = net.JoinHostPort(host, parsed.Port())
		}
		target, err = securitypolicy.NormalizeTarget(securitypolicy.Target{
			Kind:  securitypolicy.TargetOrigin,
			Value: string(protocol) + "://" + authority,
		})
		if err != nil {
			return EndpointRequest{}, err
		}
		return EndpointRequest{
			Protocol: protocol, Host: host, Port: portNumber, Target: target,
			Source: source, Purpose: purpose, RequestedBy: requestedBy,
			Status: EndpointRequestPending,
		}, nil
	case EndpointProtocolTCP, EndpointProtocolSSH:
		kind := securitypolicy.TargetSocket
		if protocol == EndpointProtocolSSH {
			kind = securitypolicy.TargetSSH
		}
		var err error
		target, err = securitypolicy.NormalizeTarget(securitypolicy.Target{
			Kind: kind, Value: rawEndpoint,
		})
		if err != nil {
			return EndpointRequest{}, err
		}
		host, port, _ := net.SplitHostPort(target.Value)
		portNumber, _ := strconv.Atoi(port)
		return EndpointRequest{
			Protocol: protocol, Host: host, Port: portNumber, Target: target,
			Source: source, Purpose: purpose, RequestedBy: requestedBy,
			Status: EndpointRequestPending,
		}, nil
	default:
		return EndpointRequest{}, fmt.Errorf("endpoint protocol must be http, https, tcp, or ssh")
	}
}

func boundedEndpointText(label, value string, maxRunes int) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !utf8.ValidString(value) || len([]rune(value)) > maxRunes {
		return "", fmt.Errorf("%s is required and must be at most %d characters", label, maxRunes)
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return "", fmt.Errorf("%s cannot contain control characters", label)
		}
	}
	return value, nil
}

func endpointTargetIsActive(
	scope securitypolicy.ScopeGrant,
	target securitypolicy.Target,
	now time.Time,
) bool {
	if err := scope.Validate(now); err != nil {
		return false
	}
	decision := securitypolicy.Decide(scope, securitypolicy.EffectRequest{
		Class: "limited_interaction", Target: target,
	}, now)
	return decision.Allowed
}

func projectEndpointAuthorization(
	facts []securityruntime.RoleFact,
) ([]EndpointRequest, []securitypolicy.ScopeGrant, error) {
	requests := make([]EndpointRequest, 0)
	requestIndexes := make(map[string]int)
	decided := make(map[string]struct{})
	for _, fact := range facts {
		if fact.PackageID != PackageID || fact.SchemaVersion != SchemaVersion {
			continue
		}
		switch fact.Kind {
		case FactEndpointRequested:
			var request EndpointRequest
			if err := json.Unmarshal(fact.Data, &request); err != nil {
				return nil, nil, fmt.Errorf("invalid CTF endpoint request")
			}
			normalized, err := normalizeEndpointRequest(EndpointRequestInput{
				Protocol: request.Protocol,
				Endpoint: request.Target.Value,
				Source:   request.Source,
				Purpose:  request.Purpose,
			}, request.RequestedBy)
			if err != nil ||
				request.ID == "" ||
				request.RequestedAt.IsZero() ||
				request.Status != EndpointRequestPending ||
				request.DecidedAt != nil ||
				request.Scope != nil ||
				request.Host != normalized.Host ||
				request.Port != normalized.Port ||
				request.Target != normalized.Target {
				return nil, nil, fmt.Errorf("invalid CTF endpoint request")
			}
			if _, exists := requestIndexes[request.ID]; exists {
				return nil, nil, fmt.Errorf("duplicate CTF endpoint request")
			}
			requestIndexes[request.ID] = len(requests)
			requests = append(requests, request)
		case FactEndpointDecided:
			var decision endpointDecision
			if err := json.Unmarshal(fact.Data, &decision); err != nil ||
				decision.RequestID == "" ||
				decision.DecidedAt.IsZero() {
				return nil, nil, fmt.Errorf("invalid CTF endpoint decision")
			}
			index, exists := requestIndexes[decision.RequestID]
			if !exists {
				return nil, nil, fmt.Errorf("CTF endpoint decision references an unknown request")
			}
			if _, exists := decided[decision.RequestID]; exists {
				return nil, nil, fmt.Errorf("CTF endpoint request has multiple decisions")
			}
			request := &requests[index]
			if decision.DecidedAt.Before(request.RequestedAt) {
				return nil, nil, fmt.Errorf("CTF endpoint decision predates its request")
			}
			switch decision.Status {
			case EndpointRequestApproved:
				if decision.Scope == nil ||
					len(decision.Scope.Targets) != 1 ||
					decision.Scope.Targets[0] != request.Target ||
					decision.Scope.Source != "ctf-endpoint:"+request.ID ||
					decision.Scope.GrantedBy != "local-user" ||
					decision.Scope.ExpiresAt.Sub(decision.Scope.CreatedAt) !=
						dynamicEndpointScopeTTL ||
					decision.Scope.CreatedAt.After(decision.DecidedAt) ||
					decision.Scope.Validate(decision.DecidedAt) != nil {
					return nil, nil, fmt.Errorf("invalid approved CTF endpoint scope")
				}
			case EndpointRequestDenied:
				if decision.Scope != nil {
					return nil, nil, fmt.Errorf("denied CTF endpoint request cannot carry a scope")
				}
			default:
				return nil, nil, fmt.Errorf("invalid CTF endpoint decision status")
			}
			request.Status = decision.Status
			request.DecidedAt = &decision.DecidedAt
			request.Scope = decision.Scope
			decided[decision.RequestID] = struct{}{}
		}
	}
	scopes := make([]securitypolicy.ScopeGrant, 0)
	for _, request := range requests {
		if request.Status == EndpointRequestApproved && request.Scope != nil {
			scopes = append(scopes, *request.Scope)
		}
	}
	return requests, scopes, nil
}
