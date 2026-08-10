package main

import (
	"context"
	"fmt"
	"time"

	"github.com/MilkSU-Official/milksu/internal/codingcollab"
	"github.com/MilkSU-Official/milksu/internal/codingenv"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

// ensureAgentManagedCodingCollaboration keeps worktree allocation behind the
// Coding task boundary. A clean Git task receives one bounded writer slot on
// its first effectful turn; non-Git and already-dirty projects continue without
// collaboration instead of asking the user to choose a worktree or writer.
func (a *App) ensureAgentManagedCodingCollaboration(
	conversationID,
	workspacePath string,
	allowPrepare bool,
) (*engine.CodingCollaborationDescriptor, error) {
	if a.codingCollab == nil {
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
	if descriptor == nil && allowPrepare {
		inspectContext, inspectCancel := context.WithTimeout(a.commandContext(), 4*time.Second)
		snapshot, inspectErr := codingenv.Inspect(inspectContext, workspacePath)
		inspectCancel()
		if inspectErr != nil {
			return nil, inspectErr
		}
		if snapshot.Git.Available && snapshot.Git.IsRepository && !snapshot.Git.Dirty {
			prepareContext, prepareCancel := context.WithTimeout(
				a.commandContext(),
				3*time.Minute,
			)
			_, prepareErr := a.codingCollab.Prepare(
				prepareContext,
				conversationID,
				workspacePath,
				codingcollab.MinWriters,
			)
			prepareCancel()
			if prepareErr != nil {
				return nil, fmt.Errorf(
					"prepare Agent-managed Coding worktree: %w",
					prepareErr,
				)
			}
			descriptorContext, descriptorCancel := context.WithTimeout(
				a.commandContext(),
				8*time.Second,
			)
			descriptor, err = a.codingCollab.Descriptor(
				descriptorContext,
				conversationID,
				workspacePath,
			)
			descriptorCancel()
			if err != nil {
				return nil, err
			}
		}
	}
	return projectCodingCollaborationDescriptor(descriptor), nil
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
