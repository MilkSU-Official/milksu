package main

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/codingcollab"
	"github.com/MilkSU-Official/milksu/internal/codingenv"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

func newCodingCollaborationManager(dataDirectory string) (*codingcollab.Manager, error) {
	return codingcollab.New(
		filepath.Join(dataDirectory, "agent-home", "coding-collaboration"),
	)
}

// resolveAgentManagedCodingCollaboration reports the writer worktrees this
// Coding task already owns. Sending a message never provisions one. A writer
// worktree is a resource for effectful subagents, so it is prepared when the
// model delegates writing work, not on the path to the first token.
func (a *App) resolveAgentManagedCodingCollaboration(
	conversationID,
	workspacePath string,
) (*engine.CodingCollaborationDescriptor, error) {
	if a.codingCollab == nil {
		return nil, nil
	}
	// A domain handoff without a user-selected project runs in the fixed
	// MilkSU temporary workspace resolved by the engine. It is deliberately
	// outside the Git worktree collaboration flow, so do not ask the
	// collaboration manager to resolve an empty project path first.
	if strings.TrimSpace(workspacePath) == "" {
		return nil, nil
	}
	descriptorContext, cancel := context.WithTimeout(a.commandContext(), 8*time.Second)
	descriptor, err := a.codingCollab.Descriptor(
		descriptorContext,
		conversationID,
		workspacePath,
	)
	cancel()
	if err != nil {
		return nil, err
	}
	return projectCodingCollaborationDescriptor(descriptor), nil
}

// prepareAgentManagedCodingCollaboration provisions the writer worktree an
// effectful subagent needs. Preparation checks out a linked worktree and copies
// the repository's ignored .worktreeinclude paths, so it runs only when the
// model has actually delegated writing work, and it reports progress in the
// conversation while it runs.
func (a *App) prepareAgentManagedCodingCollaboration(
	conversationID,
	workspacePath string,
	writers int,
) (*engine.CodingCollaborationDescriptor, error) {
	if a.codingCollab == nil {
		return nil, codingcollab.ErrGitUnavailable
	}
	if strings.TrimSpace(workspacePath) == "" {
		return nil, fmt.Errorf("this task has no Git project to isolate")
	}
	// CTF challenge directories already isolate the task, so they never receive
	// a second worktree around an already bounded workspace.
	if ctf.IsAgentWorkspace(workspacePath) {
		return nil, fmt.Errorf("the CTF challenge workspace is already isolated")
	}
	existing, err := a.resolveAgentManagedCodingCollaboration(conversationID, workspacePath)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	inspectContext, inspectCancel := context.WithTimeout(a.commandContext(), 4*time.Second)
	snapshot, inspectErr := codingenv.Inspect(inspectContext, workspacePath)
	inspectCancel()
	if inspectErr != nil {
		return nil, inspectErr
	}
	if !snapshot.Git.Available || !snapshot.Git.IsRepository {
		return nil, fmt.Errorf("this project is not a Git repository")
	}

	a.emitCodingWorktreeProgress(engine.Event{
		SessionID:  conversationID,
		Type:       "tool.started",
		ToolName:   codingWorktreeToolName,
		ToolCallID: codingWorktreeToolCallID(conversationID),
	})
	prepareContext, prepareCancel := context.WithTimeout(a.commandContext(), 3*time.Minute)
	started := time.Now()
	_, prepareErr := a.codingCollab.Prepare(
		prepareContext,
		conversationID,
		workspacePath,
		boundedWriterCount(writers),
	)
	prepareCancel()
	completed := engine.Event{
		SessionID:  conversationID,
		Type:       "tool.completed",
		ToolName:   codingWorktreeToolName,
		ToolCallID: codingWorktreeToolCallID(conversationID),
		DurationMS: time.Since(started).Milliseconds(),
		Done:       true,
	}
	if prepareErr != nil {
		completed.Error = prepareErr.Error()
		a.emitCodingWorktreeProgress(completed)
		return nil, fmt.Errorf("prepare Agent-managed Coding worktree: %w", prepareErr)
	}
	a.emitCodingWorktreeProgress(completed)
	return a.resolveAgentManagedCodingCollaboration(conversationID, workspacePath)
}

// codingWorktreeToolName labels the preparation row the conversation shows
// where model tool activity appears. The renderer owns its bilingual copy.
const codingWorktreeToolName = "milksu_worktree"

func (a *App) emitCodingWorktreeProgress(event engine.Event) {
	if a.engines == nil {
		return
	}
	a.engines.EmitProductEvent(event)
}

// boundedWriterCount keeps a requested writer count inside the collaboration
// contract. One delegated writing role needs one worktree; the request comes
// from the Sidecar, so it is clamped rather than trusted.
func boundedWriterCount(writers int) int {
	if writers < codingcollab.MinWriters {
		return codingcollab.MinWriters
	}
	if writers > codingcollab.MaxWriters {
		return codingcollab.MaxWriters
	}
	return writers
}

func codingWorktreeToolCallID(conversationID string) string {
	return "milksu-worktree-" + strings.TrimSpace(conversationID)
}

func projectCodingCollaborationDescriptor(
	descriptor *codingcollab.Descriptor,
) *engine.CodingCollaborationDescriptor {
	if descriptor == nil {
		return nil
	}
	projected := &engine.CodingCollaborationDescriptor{
		SchemaVersion:  descriptor.SchemaVersion,
		ConversationID: descriptor.ConversationID,
		Workspace:      descriptor.Workspace,
		BaseHead:       descriptor.BaseHead,
		Worktrees: make(
			[]engine.CodingCollaborationWorktree,
			0,
			len(descriptor.Worktrees),
		),
	}
	for _, worktree := range descriptor.Worktrees {
		projected.Worktrees = append(
			projected.Worktrees,
			engine.CodingCollaborationWorktree{
				ID:     worktree.ID,
				Path:   worktree.Path,
				Branch: worktree.Branch,
			},
		)
	}
	return projected
}

func (a *App) releaseAgentManagedCodingCollaboration(conversationID string) error {
	if a.codingCollab == nil {
		return nil
	}
	statusContext, statusCancel := context.WithTimeout(a.commandContext(), 8*time.Second)
	status, err := a.codingCollab.Get(statusContext, conversationID, "")
	statusCancel()
	if err != nil || !status.Active {
		return err
	}
	if !status.CanFinish {
		return fmt.Errorf(
			"Coding task still owns uncommitted or unintegrated Agent worktree changes",
		)
	}
	finishContext, finishCancel := context.WithTimeout(a.commandContext(), 30*time.Second)
	_, err = a.codingCollab.Finish(
		finishContext,
		conversationID,
		status.Workspace,
	)
	finishCancel()
	return err
}
