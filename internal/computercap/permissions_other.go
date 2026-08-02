//go:build !darwin || !cgo

package computercap

func platformPermissions(bool) Permissions {
	return Permissions{}
}
