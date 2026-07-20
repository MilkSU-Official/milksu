package ctf

import (
	"context"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

type OfflineEnvironment struct{}

func (OfflineEnvironment) Name() string { return "offline-artifact-workspace" }

func (OfflineEnvironment) Prepare(_ context.Context, job securityruntime.Job, attempt securityruntime.Attempt) (securityruntime.EnvironmentLease, error) {
	return securityruntime.EnvironmentLease{
		ID:         "ctf-env:" + attempt.ID,
		Provider:   "milksu-local",
		Target:     "artifact-job:" + job.ID,
		Resettable: true,
	}, nil
}

func (OfflineEnvironment) Release(context.Context, securityruntime.EnvironmentLease) error {
	return nil
}
