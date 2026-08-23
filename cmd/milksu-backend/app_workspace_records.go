package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/lab"
	"github.com/MilkSU-Official/milksu/internal/nssctf"
	"github.com/MilkSU-Official/milksu/internal/vuln"
	"github.com/google/uuid"
)

type workspaceRecordChanged struct {
	Action         string         `json:"action"`
	Kind           string         `json:"kind"`
	ID             string         `json:"id,omitempty"`
	IDs            []string       `json:"ids,omitempty"`
	Record         map[string]any `json:"record,omitempty"`
	ConversationID string         `json:"conversationId,omitempty"`
}

func (a *App) handleWorkspaceRecordAction(
	conversationID, action string,
	request codingWorkspaceRequest,
) (string, error) {
	kind := normalizeWorkspaceRecordKind(request.Kind)
	if kind == "" && action != "list_records" {
		return "", fmt.Errorf("workspace record kind is required")
	}
	switch action {
	case "list_records":
		return a.listWorkspaceRecords(kind, request)
	case "get_record":
		return a.getWorkspaceRecord(kind, request)
	case "create_record":
		return a.createWorkspaceRecord(conversationID, kind, request)
	case "update_record":
		return a.updateWorkspaceRecord(conversationID, kind, request)
	case "archive_records":
		return a.archiveWorkspaceRecords(conversationID, kind, request, false)
	case "restore_records":
		return a.archiveWorkspaceRecords(conversationID, kind, request, true)
	case "focus_record":
		return a.focusWorkspaceRecord(conversationID, kind, request)
	case "search_records":
		return a.searchWorkspaceRecords(kind, request)
	default:
		return "", fmt.Errorf("unknown workspace record action")
	}
}

func (a *App) listWorkspaceRecords(kind string, request codingWorkspaceRequest) (string, error) {
	limit := request.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := strings.TrimSpace(request.Query)
	records := make([]map[string]any, 0)
	switch kind {
	case "", "conversation":
		listed, err := a.listConversationRecords(request.Archived, query, limit)
		if err != nil {
			return "", err
		}
		records = append(records, listed...)
	}
	if kind == "" || kind == "lab" {
		listed, err := a.listLabRecords(request.Archived, query, limit)
		if err != nil {
			return "", err
		}
		records = append(records, listed...)
	}
	if kind == "" || kind == "cve" {
		listed, err := a.listCVERecords(query, limit)
		if err != nil {
			return "", err
		}
		records = append(records, listed...)
	}
	if kind == "" || kind == "ctf" {
		listed, err := a.listCTFRecords(query, limit)
		if err != nil {
			return "", err
		}
		records = append(records, listed...)
	}
	if len(records) > limit {
		records = records[:limit]
	}
	return encodeWorkspaceResult(map[string]any{
		"kind":    kind,
		"records": records,
	})
}

func (a *App) getWorkspaceRecord(kind string, request codingWorkspaceRequest) (string, error) {
	id := strings.TrimSpace(request.ID)
	if id == "" {
		return "", fmt.Errorf("record id is required")
	}
	switch kind {
	case "conversation":
		record, err := a.conversationRecordByID(id, request.Archived)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{"record": record})
	case "lab":
		record, err := a.labRecordByID(id, request.Archived)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{"record": record})
	case "cve":
		record, err := a.cveRecordByID(id)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{"record": record})
	case "ctf":
		if a.ctfJobs == nil {
			return "", fmt.Errorf("CTF jobs are unavailable")
		}
		projection, err := a.ctfJobs.GetJob(a.commandContext(), id)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{
			"record": map[string]any{
				"kind":   "ctf",
				"id":     projection.Job.ID,
				"title":  projection.Job.Title,
				"status": projection.Job.Status,
			},
		})
	default:
		return "", fmt.Errorf("unknown workspace record kind")
	}
}

func (a *App) createWorkspaceRecord(
	conversationID, kind string,
	request codingWorkspaceRequest,
) (string, error) {
	switch kind {
	case "conversation":
		title := clipWorkspaceTitle(request.Title)
		if title == "" {
			title = "新编码任务"
		}
		id := strings.TrimSpace(request.ID)
		if id == "" {
			id = uuid.NewString()
		}
		now := uint64(time.Now().UnixMilli())
		saved := conversation.StoredConversation{
			ID:        id,
			Title:     title,
			CreatedAt: now,
			Messages:  []conversation.StoredMessage{},
		}
		if err := a.conversations.Save(saved); err != nil {
			return "", err
		}
		record := conversationRecord(saved, false)
		a.emitWorkspaceRecordChanged("create", "conversation", saved.ID, nil, record, conversationID)
		return encodeWorkspaceResult(map[string]any{"record": record})
	case "lab":
		if a.labJobs == nil {
			return "", fmt.Errorf("lab jobs are unavailable")
		}
		id := strings.TrimSpace(request.ID)
		if id == "" {
			id = uuid.NewString()
		}
		now := time.Now().UnixMilli()
		job := lab.Job{
			ID:        id,
			Title:     clipWorkspaceTitle(request.Title),
			Scope:     request.Scope,
			Request:   strings.TrimSpace(request.Request),
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := a.labJobs.Save(job); err != nil {
			return "", err
		}
		stored, err := a.labJobs.Get(id)
		if err != nil {
			return "", err
		}
		record := labRecord(stored, false)
		a.emitWorkspaceRecordChanged("create", "lab", stored.ID, nil, record, conversationID)
		return encodeWorkspaceResult(map[string]any{"record": record})
	case "cve":
		return a.createCVERecord(conversationID, request)
	case "ctf":
		return a.createCTFRecord(conversationID, request)
	default:
		return "", fmt.Errorf("unknown workspace record kind")
	}
}

func (a *App) updateWorkspaceRecord(
	conversationID, kind string,
	request codingWorkspaceRequest,
) (string, error) {
	id := strings.TrimSpace(request.ID)
	if id == "" {
		return "", fmt.Errorf("record id is required")
	}
	switch kind {
	case "conversation":
		saved, err := a.conversations.Get(id)
		if err != nil {
			return "", err
		}
		title := clipWorkspaceTitle(request.Title)
		if title == "" {
			return "", fmt.Errorf("conversation title is required")
		}
		saved.Title = title
		if ctx := saved.DomainTaskContext; ctx != nil {
			if kindValue, _ := ctx["kind"].(string); kindValue == "lab" {
				ctx["title"] = title
				saved.DomainTaskContext = ctx
			}
		}
		if err := a.conversations.Save(saved); err != nil {
			return "", err
		}
		record := conversationRecord(saved, false)
		if domainKind, _ := saved.DomainTaskContext["kind"].(string); domainKind == "lab" {
			if jobID, _ := saved.DomainTaskContext["jobId"].(string); strings.TrimSpace(jobID) != "" && a.labJobs != nil {
				if job, jobErr := a.labJobs.Get(jobID); jobErr == nil {
					job.Title = title
					job.UpdatedAt = time.Now().UnixMilli()
					_ = a.labJobs.Save(job)
				}
			}
		}
		a.emitWorkspaceRecordChanged("update", "conversation", saved.ID, nil, record, conversationID)
		return encodeWorkspaceResult(map[string]any{"record": record})
	case "lab":
		if a.labJobs == nil {
			return "", fmt.Errorf("lab jobs are unavailable")
		}
		job, err := a.labJobs.Get(id)
		if err != nil {
			return "", err
		}
		if title := clipWorkspaceTitle(request.Title); title != "" {
			job.Title = title
		}
		if scope := strings.TrimSpace(request.Scope); scope == "local" || scope == "remote" {
			job.Scope = scope
		}
		if request.Request != "" {
			job.Request = strings.TrimSpace(request.Request)
		}
		job.UpdatedAt = time.Now().UnixMilli()
		if err := a.labJobs.Save(job); err != nil {
			return "", err
		}
		stored, err := a.labJobs.Get(id)
		if err != nil {
			return "", err
		}
		if err := a.syncLabConversation(stored); err != nil {
			return "", err
		}
		record := labRecord(stored, false)
		a.emitWorkspaceRecordChanged("update", "lab", stored.ID, nil, record, conversationID)
		return encodeWorkspaceResult(map[string]any{"record": record})
	case "cve":
		record := map[string]any{
			"kind":     "cve",
			"id":       strings.ToUpper(id),
			"title":    clipWorkspaceTitle(request.Title),
			"summary":  strings.TrimSpace(request.Summary),
			"vendor":   strings.TrimSpace(request.Vendor),
			"product":  strings.TrimSpace(request.Product),
			"affected": strings.TrimSpace(request.Affected),
		}
		if cveID := strings.ToUpper(strings.TrimSpace(request.CVEID)); cveID != "" {
			record["id"] = cveID
		}
		a.emitWorkspaceRecordChanged("update", "cve", fmt.Sprint(record["id"]), nil, record, conversationID)
		return encodeWorkspaceResult(map[string]any{"record": record})
	case "ctf":
		return "", fmt.Errorf("CTF records are updated through Evidence and Judge, not title fields")
	default:
		return "", fmt.Errorf("unknown workspace record kind")
	}
}

func (a *App) archiveWorkspaceRecords(
	conversationID, kind string,
	request codingWorkspaceRequest,
	restore bool,
) (string, error) {
	ids := recordIDs(request)
	if len(ids) == 0 {
		return "", fmt.Errorf("record ids are required")
	}
	action := "archive"
	if restore {
		action = "restore"
	}
	switch kind {
	case "conversation":
		for _, id := range ids {
			var err error
			if restore {
				err = a.RestoreConversation(id)
			} else {
				err = a.ArchiveConversation(id)
			}
			if err != nil {
				return "", err
			}
		}
	case "lab":
		if a.labJobs == nil {
			return "", fmt.Errorf("lab jobs are unavailable")
		}
		for _, id := range ids {
			var err error
			if restore {
				err = a.labJobs.Restore(id)
			} else {
				err = a.labJobs.Archive(id)
			}
			if err != nil {
				return "", err
			}
		}
	default:
		return "", fmt.Errorf("%s is not supported for %s records", action, kind)
	}
	a.emitWorkspaceRecordChanged(action, kind, "", ids, nil, conversationID)
	return encodeWorkspaceResult(map[string]any{
		"kind":   kind,
		"action": action,
		"ids":    ids,
	})
}

func (a *App) focusWorkspaceRecord(
	conversationID, kind string,
	request codingWorkspaceRequest,
) (string, error) {
	id := strings.TrimSpace(request.ID)
	if id == "" {
		return "", fmt.Errorf("record id is required")
	}
	record := map[string]any{
		"kind": kind,
		"id":   id,
	}
	if kind == "lab" {
		record["conversationId"] = "lab-job-" + id
	}
	if kind == "cve" {
		record["id"] = strings.ToUpper(id)
	}
	a.emitWorkspaceRecordChanged("focus", kind, fmt.Sprint(record["id"]), nil, record, conversationID)
	return encodeWorkspaceResult(map[string]any{"record": record, "focused": true})
}

func (a *App) searchWorkspaceRecords(kind string, request codingWorkspaceRequest) (string, error) {
	query := strings.TrimSpace(request.Query)
	if query == "" {
		query = strings.TrimSpace(request.Title)
	}
	switch kind {
	case "cve":
		snapshot, err := a.SearchNVDCVEs(query)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{
			"kind":       "cve",
			"query":      query,
			"source":     snapshot.SourceName,
			"sourceUrl":  snapshot.SourceURL,
			"candidates": parseNVDCVECandidates(snapshot.Body, 10),
		})
	case "ctf":
		if a.nssctfCatalog == nil {
			return "", fmt.Errorf("CTF catalog is unavailable")
		}
		page, err := a.nssctfCatalog.Search(a.commandContext(), nssctf.CatalogQuery{
			Query:    query,
			Page:     1,
			PageSize: 20,
		})
		if err != nil {
			return "", err
		}
		candidates := make([]map[string]any, 0, len(page.Problems))
		for _, problem := range page.Problems {
			candidates = append(candidates, map[string]any{
				"id":         fmt.Sprintf("P%d", problem.PlatformID),
				"title":      problem.Title,
				"category":   problem.Category,
				"url":        problem.SourceURL,
				"platformId": problem.PlatformID,
			})
		}
		return encodeWorkspaceResult(map[string]any{
			"kind":       "ctf",
			"query":      query,
			"source":     "nssctf-catalog",
			"candidates": candidates,
		})
	case "conversation", "lab":
		return a.listWorkspaceRecords(kind, request)
	default:
		return "", fmt.Errorf("search is not available for %s records", kind)
	}
}

func (a *App) createCVERecord(conversationID string, request codingWorkspaceRequest) (string, error) {
	cveID := strings.ToUpper(strings.TrimSpace(request.CVEID))
	if cveID == "" {
		cveID = strings.ToUpper(strings.TrimSpace(request.ID))
	}
	if cveID == "" {
		return "", fmt.Errorf("CVE records need a CVE-YYYY-NNNN id")
	}
	title := clipWorkspaceTitle(request.Title)
	summary := strings.TrimSpace(request.Summary)
	if (title == "" || summary == "") && a.vulnJobs != nil {
		if snapshot, err := a.FetchNVDCVE(cveID); err == nil {
			if candidates := parseNVDCVECandidates(snapshot.Body, 1); len(candidates) > 0 {
				if title == "" {
					title = fmt.Sprint(candidates[0]["title"])
				}
				if summary == "" {
					summary = fmt.Sprint(candidates[0]["summary"])
				}
			}
		}
	}
	if a.vulnJobs != nil {
		if _, err := a.EnsureVulnTrackingWorkspace(vuln.TrackingWorkspaceRequest{
			CVEID:         cveID,
			Title:         title,
			Summary:       summary,
			ReferenceHref: strings.TrimSpace(request.URL),
		}); err != nil {
			return "", err
		}
	}
	record := map[string]any{
		"kind":     "cve",
		"id":       cveID,
		"title":    title,
		"summary":  summary,
		"vendor":   strings.TrimSpace(request.Vendor),
		"product":  strings.TrimSpace(request.Product),
		"affected": strings.TrimSpace(request.Affected),
		"url":      strings.TrimSpace(request.URL),
	}
	a.emitWorkspaceRecordChanged("create", "cve", cveID, nil, record, conversationID)
	return encodeWorkspaceResult(map[string]any{"record": record})
}

func (a *App) createCTFRecord(conversationID string, request codingWorkspaceRequest) (string, error) {
	if a.ctfJobs == nil {
		return "", fmt.Errorf("CTF jobs are unavailable")
	}
	title := clipWorkspaceTitle(request.Title)
	statement := strings.TrimSpace(request.Statement)
	sourceURI := strings.TrimSpace(request.URL)
	category := strings.TrimSpace(request.Category)
	sourceKind := strings.TrimSpace(request.SourceKind)
	if sourceKind == "" {
		if sourceURI != "" {
			sourceKind = "url"
		} else {
			sourceKind = "text"
		}
	}
	var knowledge []string
	var externalPlatform string
	var externalAttemptID int64
	if sourceURI != "" && a.nssctf != nil {
		if imported, err := a.nssctf.ImportChallenge(a.commandContext(), sourceURI); err == nil {
			if title == "" {
				title = imported.Title
			}
			if statement == "" {
				statement = imported.Statement
			}
			if category == "" {
				category = imported.Category
			}
			knowledge = append([]string{}, imported.Tags...)
			externalPlatform = "nssctf-web"
			externalAttemptID = int64(imported.PlatformID)
			sourceURI = imported.SourceURL
			sourceKind = "url"
		}
	}
	if title == "" || statement == "" {
		return "", fmt.Errorf("CTF records need title and statement, or an importable challenge URL")
	}
	projection, err := a.StartCTFChallenge(ctf.ChallengeRequest{
		Title:             title,
		Statement:         statement,
		Category:          category,
		CollaborationMode: "copilot",
		DeferAgent:        true,
		SourceKind:        sourceKind,
		SourceURI:         sourceURI,
		ExternalPlatform:  externalPlatform,
		ExternalAttemptID: externalAttemptID,
		KnowledgePoints:   knowledge,
	})
	if err != nil {
		return "", err
	}
	record := map[string]any{
		"kind":   "ctf",
		"id":     projection.Job.ID,
		"title":  projection.Job.Title,
		"status": projection.Job.Status,
	}
	a.emitWorkspaceRecordChanged("create", "ctf", projection.Job.ID, nil, record, conversationID)
	return encodeWorkspaceResult(map[string]any{"record": record})
}

func (a *App) listConversationRecords(archived bool, query string, limit int) ([]map[string]any, error) {
	var values []conversation.StoredConversation
	var err error
	if archived {
		values, err = a.conversations.ListArchived()
	} else {
		values, err = a.conversations.List()
	}
	if err != nil {
		return nil, err
	}
	records := make([]map[string]any, 0, len(values))
	for _, value := range values {
		record := conversationRecord(value, archived)
		if !recordMatchesQuery(record, query) {
			continue
		}
		records = append(records, record)
		if len(records) >= limit {
			break
		}
	}
	return records, nil
}

func (a *App) listLabRecords(archived bool, query string, limit int) ([]map[string]any, error) {
	if a.labJobs == nil {
		return nil, nil
	}
	var values []lab.Job
	var err error
	if archived {
		values, err = a.labJobs.ListArchived()
	} else {
		values, err = a.labJobs.List()
	}
	if err != nil {
		return nil, err
	}
	records := make([]map[string]any, 0, len(values))
	for _, value := range values {
		record := labRecord(value, archived)
		if !recordMatchesQuery(record, query) {
			continue
		}
		records = append(records, record)
		if len(records) >= limit {
			break
		}
	}
	return records, nil
}

func (a *App) listCVERecords(query string, limit int) ([]map[string]any, error) {
	records := make([]map[string]any, 0)
	if a.vulnJobs != nil {
		jobs, err := a.vulnJobs.ListJobs(a.commandContext())
		if err != nil {
			return nil, err
		}
		for _, job := range jobs {
			record := map[string]any{
				"kind":   "cve",
				"id":     job.ID,
				"title":  job.Title,
				"status": job.Status,
			}
			if !recordMatchesQuery(record, query) {
				continue
			}
			records = append(records, record)
			if len(records) >= limit {
				return records, nil
			}
		}
	}
	values, err := a.conversations.List()
	if err != nil {
		return records, err
	}
	for _, value := range values {
		if domainKind, _ := value.DomainTaskContext["kind"].(string); domainKind != "cve" {
			continue
		}
		cveID, _ := value.DomainTaskContext["cveId"].(string)
		record := map[string]any{
			"kind":           "cve",
			"id":             strings.ToUpper(strings.TrimSpace(cveID)),
			"title":          value.Title,
			"conversationId": value.ID,
		}
		if record["id"] == "" {
			record["id"] = value.ID
		}
		if !recordMatchesQuery(record, query) {
			continue
		}
		records = append(records, record)
		if len(records) >= limit {
			break
		}
	}
	return records, nil
}

func (a *App) listCTFRecords(query string, limit int) ([]map[string]any, error) {
	if a.ctfJobs == nil {
		return nil, nil
	}
	jobs, err := a.ctfJobs.ListJobs(a.commandContext())
	if err != nil {
		return nil, err
	}
	records := make([]map[string]any, 0, len(jobs))
	for _, job := range jobs {
		record := ctfRecordFromSummary(job)
		if !recordMatchesQuery(record, query) {
			continue
		}
		records = append(records, record)
		if len(records) >= limit {
			break
		}
	}
	return records, nil
}

func (a *App) conversationRecordByID(id string, archived bool) (map[string]any, error) {
	if archived {
		values, err := a.conversations.ListArchived()
		if err != nil {
			return nil, err
		}
		for _, value := range values {
			if value.ID == id {
				return conversationRecord(value, true), nil
			}
		}
		return nil, fmt.Errorf("archived conversation not found")
	}
	saved, err := a.conversations.Get(id)
	if err != nil {
		return nil, err
	}
	return conversationRecord(saved, false), nil
}

func (a *App) labRecordByID(id string, archived bool) (map[string]any, error) {
	if a.labJobs == nil {
		return nil, fmt.Errorf("lab jobs are unavailable")
	}
	if archived {
		values, err := a.labJobs.ListArchived()
		if err != nil {
			return nil, err
		}
		for _, value := range values {
			if value.ID == id {
				return labRecord(value, true), nil
			}
		}
		return nil, fmt.Errorf("archived lab job not found")
	}
	job, err := a.labJobs.Get(id)
	if err != nil {
		return nil, err
	}
	return labRecord(job, false), nil
}

func (a *App) cveRecordByID(id string) (map[string]any, error) {
	normalized := strings.ToUpper(strings.TrimSpace(id))
	if a.vulnJobs != nil {
		jobs, err := a.vulnJobs.ListJobs(a.commandContext())
		if err != nil {
			return nil, err
		}
		for _, job := range jobs {
			if job.ID == id || strings.Contains(strings.ToUpper(job.Title), normalized) {
				return map[string]any{
					"kind":   "cve",
					"id":     job.ID,
					"title":  job.Title,
					"status": job.Status,
				}, nil
			}
		}
	}
	values, err := a.conversations.List()
	if err != nil {
		return nil, err
	}
	for _, value := range values {
		if domainKind, _ := value.DomainTaskContext["kind"].(string); domainKind != "cve" {
			continue
		}
		cveID, _ := value.DomainTaskContext["cveId"].(string)
		if value.ID == id || strings.EqualFold(cveID, normalized) {
			return map[string]any{
				"kind":           "cve",
				"id":             strings.ToUpper(strings.TrimSpace(cveID)),
				"title":          value.Title,
				"conversationId": value.ID,
			}, nil
		}
	}
	return nil, fmt.Errorf("CVE record not found")
}

func (a *App) syncLabConversation(job lab.Job) error {
	conversationID := "lab-job-" + job.ID
	saved, err := a.conversations.Get(conversationID)
	if err != nil {
		return nil
	}
	saved.Title = job.Title
	if saved.DomainTaskContext == nil {
		saved.DomainTaskContext = map[string]any{}
	}
	saved.DomainTaskContext["kind"] = "lab"
	saved.DomainTaskContext["jobId"] = job.ID
	saved.DomainTaskContext["title"] = job.Title
	saved.DomainTaskContext["scope"] = job.Scope
	saved.DomainTaskContext["request"] = job.Request
	return a.conversations.Save(saved)
}

func (a *App) emitWorkspaceRecordChanged(
	action, kind, id string,
	ids []string,
	record map[string]any,
	conversationID string,
) {
	a.emitDesktopEvent("workspace-record.changed", workspaceRecordChanged{
		Action:         action,
		Kind:           kind,
		ID:             id,
		IDs:            ids,
		Record:         record,
		ConversationID: conversationID,
	})
}

func conversationRecord(value conversation.StoredConversation, archived bool) map[string]any {
	domainKind := ""
	if value.DomainTaskContext != nil {
		domainKind, _ = value.DomainTaskContext["kind"].(string)
	}
	return map[string]any{
		"kind":           "conversation",
		"id":             value.ID,
		"title":          value.Title,
		"createdAt":      value.CreatedAt,
		"archived":       archived,
		"domainKind":     domainKind,
		"ctfJobId":       value.CTFJobID,
		"messageCount":   len(value.Messages),
		"conversationId": value.ID,
	}
}

func labRecord(value lab.Job, archived bool) map[string]any {
	return map[string]any{
		"kind":           "lab",
		"id":             value.ID,
		"title":          value.Title,
		"scope":          value.Scope,
		"request":        value.Request,
		"createdAt":      value.CreatedAt,
		"updatedAt":      value.UpdatedAt,
		"archived":       archived,
		"conversationId": "lab-job-" + value.ID,
	}
}

func ctfRecordFromSummary(value ctf.Summary) map[string]any {
	return map[string]any{
		"kind":     "ctf",
		"id":       value.ID,
		"title":    value.Title,
		"category": value.Category,
		"status":   value.Status,
	}
}

func recordIDs(request codingWorkspaceRequest) []string {
	ids := make([]string, 0, len(request.IDs)+1)
	seen := map[string]bool{}
	for _, id := range append([]string{request.ID}, request.IDs...) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids
}

func recordMatchesQuery(record map[string]any, query string) bool {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return true
	}
	haystack := strings.ToLower(strings.Join([]string{
		fmt.Sprint(record["id"]),
		fmt.Sprint(record["title"]),
		fmt.Sprint(record["request"]),
		fmt.Sprint(record["summary"]),
		fmt.Sprint(record["category"]),
	}, " "))
	return strings.Contains(haystack, query)
}

func normalizeWorkspaceRecordKind(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "conversation", "lab", "cve", "ctf":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func clipWorkspaceTitle(value string) string {
	line := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	runes := []rune(line)
	if len(runes) <= 40 {
		return line
	}
	return string(runes[:40])
}

func parseNVDCVECandidates(body string, limit int) []map[string]any {
	if limit <= 0 {
		limit = 10
	}
	var parsed struct {
		Vulnerabilities []struct {
			CVE struct {
				ID           string `json:"id"`
				Descriptions []struct {
					Lang  string `json:"lang"`
					Value string `json:"value"`
				} `json:"descriptions"`
			} `json:"cve"`
		} `json:"vulnerabilities"`
	}
	if json.Unmarshal([]byte(body), &parsed) != nil {
		return nil
	}
	candidates := make([]map[string]any, 0, limit)
	for _, item := range parsed.Vulnerabilities {
		id := strings.ToUpper(strings.TrimSpace(item.CVE.ID))
		if id == "" {
			continue
		}
		summary := ""
		for _, description := range item.CVE.Descriptions {
			lang := strings.ToLower(strings.TrimSpace(description.Lang))
			text := strings.TrimSpace(description.Value)
			if text == "" {
				continue
			}
			if lang == "zh" || lang == "en" || summary == "" {
				summary = text
			}
			if lang == "zh" {
				break
			}
		}
		title := id
		if summary != "" {
			runes := []rune(summary)
			if len(runes) > 80 {
				title = string(runes[:80])
			} else {
				title = summary
			}
		}
		candidates = append(candidates, map[string]any{
			"id":      id,
			"title":   title,
			"summary": summary,
			"url":     "https://nvd.nist.gov/vuln/detail/" + id,
		})
		if len(candidates) >= limit {
			break
		}
	}
	return candidates
}
