package evalbench

const (
	CatalogSchemaVersion          = "milksu.evalbench.catalog/v1alpha1"
	RunSchemaVersion              = "milksu.evalbench.run/v1alpha1"
	ReportSchemaVersion           = "milksu.evalbench.report/v1alpha1"
	AdmissionSchemaVersion        = "milksu.evalbench.admission/v1alpha1"
	BaselineRunSchemaVersion      = "milksu.evalbench.baseline-run/v1alpha1"
	SafeStaticReviewPolicyVersion = "milksu.safe-static-review/v1"

	NYUCTFBenchSourceID                = "nyu-ctf-bench"
	NYUCTFBenchVersion                 = "v20250206"
	NYUCTFBenchRevision                = "1dc13a0dc41a71504f727649679e2b5a6d0cb1b1"
	NYUCTFBenchRepositoryURL           = "https://github.com/NYU-LLM-CTF/NYU_CTF_Bench"
	NYUCTFBenchPaperURL                = "https://proceedings.neurips.cc/paper_files/paper/2024/file/69d97a6493fbf016fff0a751f253ad18-Paper-Datasets_and_Benchmarks_Track.pdf"
	NYUCTFBenchLicense                 = "GPL-2.0-only"
	NYUCTFBenchLicenseURL              = "https://github.com/NYU-LLM-CTF/NYU_CTF_Bench/blob/1dc13a0dc41a71504f727649679e2b5a6d0cb1b1/LICENSE"
	DeepSeekPricingURL                 = "https://api-docs.deepseek.com/quick_start/pricing"
	DeepSeekPricingCheckedDate         = "2026-08-01"
	ReportedResultAuthority            = "reported-not-verified"
	DeterministicStaticAnswerAuthority = "deterministic-static-answer-sha256"
	MixedResultAuthority               = "mixed-result-authority"
	defaultMaximumCatalogSize          = 16 << 20
	defaultMaximumAdmissionSize        = 4 << 20
)

// Source identifies the exact benchmark snapshot consumed by an adapter.
// MilkSU does not vendor the dataset: users provide a local checkout.
type Source struct {
	ID            string `json:"id"`
	Version       string `json:"version"`
	Revision      string `json:"revision"`
	RepositoryURL string `json:"repositoryUrl"`
	PaperURL      string `json:"paperUrl"`
	License       string `json:"license"`
	LicenseURL    string `json:"licenseUrl"`
}

func NYUCTFBenchSource() Source {
	return Source{
		ID:            NYUCTFBenchSourceID,
		Version:       NYUCTFBenchVersion,
		Revision:      NYUCTFBenchRevision,
		RepositoryURL: NYUCTFBenchRepositoryURL,
		PaperURL:      NYUCTFBenchPaperURL,
		License:       NYUCTFBenchLicense,
		LicenseURL:    NYUCTFBenchLicenseURL,
	}
}
