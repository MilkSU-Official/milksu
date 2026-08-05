package ctf

type PlatformIntegrationStatus string

const (
	PlatformReady      PlatformIntegrationStatus = "ready"
	PlatformPlanned    PlatformIntegrationStatus = "planned"
	PlatformRestricted PlatformIntegrationStatus = "restricted"
)

type TrainingPlatform struct {
	ID           string                    `json:"id"`
	Name         string                    `json:"name"`
	Experience   string                    `json:"experience"`
	Status       PlatformIntegrationStatus `json:"status"`
	Adapter      string                    `json:"adapter"`
	Selectable   bool                      `json:"selectable"`
	Capabilities []string                  `json:"capabilities"`
	Requirement  string                    `json:"requirement,omitempty"`
	SourceURL    string                    `json:"sourceUrl"`
}

func TrainingPlatforms() []TrainingPlatform {
	return []TrainingPlatform{
		{
			ID: "nssctf", Name: "NSSCTF", Experience: "competition-and-challenge-library",
			Status: PlatformReady, Adapter: "public-api-and-browser-bridge", Selectable: true,
			Capabilities: []string{
				"catalog", "challenge", "materials", "judge", "agent-arena",
			},
			SourceURL: "https://www.nssctf.cn/problem",
		},
		{
			ID: "ctfshow", Name: "CTFshow", Experience: "challenge-library",
			Status: PlatformReady, Adapter: "browser-bridge", Selectable: true,
			Capabilities: []string{"catalog", "challenge", "materials", "judge"},
			SourceURL:    "https://ctf.show/challenges",
		},
		{
			ID: "hackthebox", Name: "HTB Labs", Experience: "interactive-lab",
			Status: PlatformRestricted, Adapter: "permission-gated-official-labs", Selectable: false,
			Capabilities: []string{
				"machines", "starting-point", "challenges", "human-only", "written-permission",
			},
			Requirement: "HTB written permission or an AI Range entitlement is required before any Agent receives HTB content or targets",
			SourceURL:   "https://app.hackthebox.com/machines",
		},
		{
			ID: "tryhackme", Name: "TryHackMe", Experience: "guided-room-and-interactive-lab",
			Status: PlatformRestricted, Adapter: "official-enterprise-rest-api", Selectable: false,
			Capabilities: []string{
				"room-catalog", "room-questions", "scoreboard", "time-report",
			},
			Requirement: "Business or Classroom plan with THM-API-KEY; no official consumer API for full room and VM control",
			SourceURL:   "https://help.tryhackme.com/en/articles/6498330-enterprise-api",
		},
	}
}
