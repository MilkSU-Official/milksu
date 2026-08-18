//go:build !darwin && !windows

package computercap

func platformSigningStatus() SigningStatus {
	return SigningStatus{
		BundleID:       resolveHostBundleID(nil),
		Signature:      "unsupported",
		StableIdentity: false,
		Problem:        "Computer Use 签名诊断当前仅适用于 macOS。",
	}
}
