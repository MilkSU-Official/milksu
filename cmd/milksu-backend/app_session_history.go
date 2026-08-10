package main

import (
	"fmt"
	"time"

	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	"github.com/MilkSU-Official/milksu/internal/sessionindex"
	"github.com/MilkSU-Official/milksu/internal/vuln"
)

func (a *App) GetSessionIndexStatus() (sessionindex.Status, error) {
	if a.sessionIndex == nil {
		return sessionindex.Status{}, fmt.Errorf("session index is not ready")
	}
	if _, err := a.RefreshSessionIndex(); err != nil {
		return sessionindex.Status{}, err
	}
	return a.sessionIndex.Status(a.commandContext())
}

func (a *App) RefreshSessionIndex() (sessionindex.RefreshResult, error) {
	if a.sessionIndex == nil {
		return sessionindex.RefreshResult{}, fmt.Errorf("session index is not ready")
	}
	conversations, err := a.conversations.List()
	if err != nil {
		return sessionindex.RefreshResult{}, err
	}
	return a.sessionIndex.RefreshMilkSUConversations(a.commandContext(), conversations)
}

func (a *App) SearchSessionHistory(request sessionindex.SearchRequest) (sessionindex.SearchResponse, error) {
	if a.sessionIndex == nil {
		return sessionindex.SearchResponse{}, fmt.Errorf("session index is not ready")
	}
	if _, err := a.RefreshSessionIndex(); err != nil {
		return sessionindex.SearchResponse{}, err
	}
	return a.sessionIndex.Search(a.commandContext(), request)
}

func (a *App) GetSessionHistoryGraph(request sessionindex.GraphRequest) (sessionindex.GraphResponse, error) {
	if a.sessionIndex == nil {
		return sessionindex.GraphResponse{}, fmt.Errorf("session index is not ready")
	}
	if _, err := a.RefreshSessionIndex(); err != nil {
		return sessionindex.GraphResponse{}, err
	}
	archives, err := a.sessionHistoryArchives()
	if err != nil {
		return sessionindex.GraphResponse{}, err
	}
	graphContext, err := a.sessionIndex.BuildGraphContext(a.commandContext(), request, sessionindex.GraphInput{
		Archives: archives,
	})
	if err != nil {
		return sessionindex.GraphResponse{}, err
	}
	if len(graphContext.Seeds) == 0 {
		return sessionindex.EmptyGraphResponse(graphContext, time.Now()), nil
	}
	prompt, err := sessionindex.SemanticGraphPrompt(graphContext)
	if err != nil {
		return sessionindex.GraphResponse{}, err
	}
	generated, err := a.engines.GenerateText(prompt, a.settings.GetResolved())
	if err != nil {
		return sessionindex.GraphResponse{}, err
	}
	return sessionindex.ProjectSemanticGraph(
		generated.Text,
		graphContext,
		generated.Provider,
		generated.Model,
		time.Now(),
	)
}

func (a *App) sessionHistoryArchives() ([]sessionindex.GraphArchive, error) {
	if a.jobs == nil {
		return nil, nil
	}
	ctx := a.commandContext()
	summaries, err := a.jobs.ListJobs(ctx)
	if err != nil {
		return nil, fmt.Errorf("list session history archives: %w", err)
	}
	archives := make([]sessionindex.GraphArchive, 0, len(summaries))
	for _, summary := range summaries {
		module := ""
		switch summary.Role {
		case ctf.PackageID:
			module = "ctf"
		case vuln.PackageID:
			module = "cve"
		default:
			continue
		}
		projection, projectionErr := a.jobs.GetJob(ctx, summary.ID)
		if projectionErr != nil {
			return nil, fmt.Errorf("read session history archive %s: %w", summary.ID, projectionErr)
		}
		archives = append(archives, graphArchiveFromRuntime(module, projection))
	}
	return archives, nil
}

func graphArchiveFromRuntime(module string, projection securityruntime.JobProjection) sessionindex.GraphArchive {
	archive := sessionindex.GraphArchive{
		ID:        projection.Job.ID,
		Module:    module,
		Title:     projection.Job.Title,
		Timestamp: projection.Job.UpdatedAt.UTC().Format(time.RFC3339Nano),
		Evidence:  make([]sessionindex.GraphArchiveEvidence, 0, len(projection.Evidence)),
		Artifacts: make([]sessionindex.GraphArchiveArtifact, 0, len(projection.Artifacts)),
	}
	for _, evidence := range projection.Evidence {
		archive.Evidence = append(archive.Evidence, sessionindex.GraphArchiveEvidence{
			ID:          evidence.ID,
			Claim:       evidence.Claim,
			Provenance:  evidence.Provenance,
			ArtifactIDs: append([]string{}, evidence.ArtifactIDs...),
		})
	}
	for _, artifact := range projection.Artifacts {
		archive.Artifacts = append(archive.Artifacts, sessionindex.GraphArchiveArtifact{
			ID:           artifact.ID,
			Source:       artifact.Source,
			MediaType:    artifact.MediaType,
			RelativePath: artifact.RelativePath,
			Size:         artifact.Size,
		})
	}
	return archive
}
