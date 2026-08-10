package main

import "github.com/MilkSU-Official/milksu/internal/ctf"

func (a *App) RequestCTFEndpoint(
	id string,
	request ctf.EndpointRequestInput,
) (ctf.Projection, error) {
	return a.ctfJobs.RequestDynamicEndpoint(
		a.commandContext(),
		id,
		request,
		ctf.EndpointRequesterUser,
	)
}

func (a *App) ApproveCTFEndpoint(id, requestID string) (ctf.Projection, error) {
	projection, err := a.ctfJobs.DecideDynamicEndpoint(
		a.commandContext(),
		id,
		requestID,
		true,
	)
	if err != nil {
		return ctf.Projection{}, err
	}
	// The Sidecar captures its immutable policy when a Pi session starts.
	// Regenerate the signed-off manifest and dispose only the live process-side
	// tools so the persisted conversation/checkpoint resumes under the new
	// exact Scope instead of retaining a stale policy object.
	handoff, err := a.PrepareCTFAgentWorkspace(id)
	if err != nil {
		return ctf.Projection{}, err
	}
	a.engines.DetachSession(handoff.ConversationID)
	return projection, nil
}

func (a *App) DenyCTFEndpoint(id, requestID string) (ctf.Projection, error) {
	return a.ctfJobs.DecideDynamicEndpoint(
		a.commandContext(),
		id,
		requestID,
		false,
	)
}
