package main

import "github.com/MilkSU-Official/milksu/internal/lab"

func (a *App) ListLabJobs() ([]lab.Job, error) {
	if a.labJobs == nil {
		return nil, nil
	}
	return a.labJobs.List()
}

func (a *App) ListArchivedLabJobs() ([]lab.Job, error) {
	if a.labJobs == nil {
		return nil, nil
	}
	return a.labJobs.ListArchived()
}

func (a *App) SaveLabJob(value lab.Job) error {
	if a.labJobs == nil {
		return nil
	}
	return a.labJobs.Save(value)
}

func (a *App) ArchiveLabJob(id string) error {
	if a.labJobs == nil {
		return nil
	}
	return a.labJobs.Archive(id)
}

func (a *App) RestoreLabJob(id string) error {
	if a.labJobs == nil {
		return nil
	}
	return a.labJobs.Restore(id)
}
