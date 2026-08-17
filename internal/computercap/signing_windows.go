//go:build windows

package computercap

func platformSigningStatus() SigningStatus {
	return SigningStatus{
		BundleID:       resolveHostBundleID(nil),
		Signature:      "windows-user-session",
		StableIdentity: true,
	}
}
