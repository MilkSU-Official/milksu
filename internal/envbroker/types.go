package envbroker

const LeaseSchema = "milksu-env-lease/v1"

type Owner struct {
	Kind string `json:"ownerKind"`
	ID   string `json:"ownerId"`
}

type Challenge struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Kind     string `json:"kind"`
	Guidance string `json:"guidance"`
}

type Package struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Category    string      `json:"category,omitempty"`
	KindLabel   string      `json:"kindLabel"`
	Detail      string      `json:"detail"`
	Source      string      `json:"source,omitempty"`
	Purpose     string      `json:"purpose,omitempty"`
	Difficulty  string      `json:"difficulty,omitempty"`
	Brief       string      `json:"brief,omitempty"`
	Provider    string      `json:"provider"`
	Surface     string      `json:"surface"`
	Address     string      `json:"address"`
	Port        int         `json:"port,omitempty"`
	CVEIDs      []string    `json:"cveIds,omitempty"`
	Challenges  []Challenge `json:"challenges,omitempty"`
	ComposePath string      `json:"-"`
	ApkURL      string      `json:"-"`
	ApkSHA256   string      `json:"-"`
	ApkName     string      `json:"-"`
	Launcher    string      `json:"-"`
}

type Lease struct {
	Schema          string `json:"schema"`
	OwnerKind       string `json:"ownerKind"`
	OwnerID         string `json:"ownerId"`
	PackageID       string `json:"packageId,omitempty"`
	PackageName     string `json:"packageName,omitempty"`
	Provider        string `json:"provider"`
	Surface         string `json:"surface,omitempty"`
	State           string `json:"state"`
	Address         string `json:"address,omitempty"`
	Device          string `json:"device,omitempty"`
	Detail          string `json:"detail,omitempty"`
	Error           string `json:"error,omitempty"`
	OccupyOwner     string `json:"occupyOwner,omitempty"`
	OccupyTitle     string `json:"occupyTitle,omitempty"`
	DockerAvailable bool   `json:"dockerAvailable,omitempty"`
	UpdatedAt       string `json:"updatedAt"`
}

type StartRequest struct {
	OwnerKind string `json:"ownerKind"`
	OwnerID   string `json:"ownerId"`
	PackageID string `json:"packageId"`
}

func (o Owner) Key() string {
	return o.Kind + ":" + o.ID
}
