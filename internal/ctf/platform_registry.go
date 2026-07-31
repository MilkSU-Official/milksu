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
			ID: "hackthebox", Name: "Hack The Box", Experience: "competition-and-interactive-lab",
			Status: PlatformPlanned, Adapter: "official-remote-mcp", Selectable: false,
			Capabilities: []string{
				"ctf-events", "challenge-instances", "judge", "solve-stats",
			},
			Requirement: "HTB MCP token; Labs machine support waits for an official standard-account interface",
			SourceURL:   "https://mcp.hackthebox.ai/v1/ctf/mcp/",
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
