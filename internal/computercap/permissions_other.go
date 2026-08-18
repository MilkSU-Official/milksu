//go:build (!darwin && !windows) || (darwin && !cgo)

package computercap

func platformPermissions(bool) Permissions {
	return Permissions{}
}

func platformRequestPermissions(PermissionKind) {}
