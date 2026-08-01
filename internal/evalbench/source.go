package evalbench

const (
	CatalogSchemaVersion = "milksu.evalbench.catalog/v1alpha1"
	RunSchemaVersion     = "milksu.evalbench.run/v1alpha1"
	ReportSchemaVersion  = "milksu.evalbench.report/v1alpha1"

	NYUCTFBenchSourceID       = "nyu-ctf-bench"
	NYUCTFBenchVersion        = "v20250206"
	NYUCTFBenchRevision       = "1dc13a0dc41a71504f727649679e2b5a6d0cb1b1"
	NYUCTFBenchRepositoryURL  = "https://github.com/NYU-LLM-CTF/NYU_CTF_Bench"
	NYUCTFBenchPaperURL       = "https://proceedings.neurips.cc/paper_files/paper/2024/file/69d97a6493fbf016fff0a751f253ad18-Paper-Datasets_and_Benchmarks_Track.pdf"
	NYUCTFBenchLicense        = "GPL-2.0-only"
	NYUCTFBenchLicenseURL     = "https://github.com/NYU-LLM-CTF/NYU_CTF_Bench/blob/1dc13a0dc41a71504f727649679e2b5a6d0cb1b1/LICENSE"
	ReportedResultAuthority   = "reported-not-verified"
	defaultMaximumCatalogSize = 16 << 20
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
